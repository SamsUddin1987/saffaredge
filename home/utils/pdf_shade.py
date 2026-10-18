import io
import os
import base64

from django.conf import settings
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import csrf_exempt


# =========================================================
# SAVE SHADE SAMPLE (OPTIONAL – overwrite)
# =========================================================
@csrf_exempt
def save_shade_sample(request):
    if request.method != "POST":
        return JsonResponse({"status": "error"})

    b64 = request.POST.get("sample_image_base64")
    if not b64:
        return JsonResponse({"status": "error"})

    if "," in b64:
        b64 = b64.split(",")[1]

    img_bytes = base64.b64decode(b64)

    shade_dir = os.path.join(settings.BASE_DIR, "shade_samples")
    os.makedirs(shade_dir, exist_ok=True)

    path = os.path.join(shade_dir, "shade_image.png")
    with open(path, "wb") as f:
        f.write(img_bytes)

    return JsonResponse({"status": "ok"})


# =========================================================
# MAIN SHADE PROCESS (RANGE-BASED)
# =========================================================
def handle_shade_request(request):
    if request.method == "POST":
        try:
            import cv2
            import numpy as np
            from pdf2image import convert_from_bytes
            from PIL import Image

            # ---- USER RANGE (REFERENCE STYLE) ----
            lo = int(request.POST.get("shade_min", 160))
            hi = int(request.POST.get("shade_max", 240))

            target = request.FILES.get("target_file")
            if not target:
                return render(request, "pdf/shade.html", {
                    "error": "Please select a file to clean."
                })

            data = target.read()
            is_pdf = target.name.lower().endswith(".pdf")

            if is_pdf:
                buffer = _process_pdf(data, lo, hi)
                ctype = "application/pdf"
            else:
                buffer = _process_image(data, lo, hi)
                ctype = "image/jpeg"

            resp = HttpResponse(buffer.getvalue(), content_type=ctype)
            resp["Content-Disposition"] = (
                f'attachment; filename="cleaned_{target.name}"'
            )
            return resp

        except Exception as e:
            return render(request, "pdf/shade.html", {
                "error": str(e)
            })

    return render(request, "pdf/shade.html")


# =========================================================
# CORE SHADE REMOVAL (REFERENCE LOGIC)
# =========================================================
def _remove_shade(img_bgr, lo, hi):
    import cv2
    import numpy as np

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gray_blur = cv2.GaussianBlur(gray, (3, 3), 0)

    mask = (gray_blur >= lo) & (gray_blur <= hi)

    result = img_bgr.copy()
    result[mask] = [255, 255, 255]
    return result


def _process_image(file_bytes, lo, hi):
    import cv2
    import numpy as np

    img = cv2.imdecode(
        np.frombuffer(file_bytes, np.uint8),
        cv2.IMREAD_COLOR
    )
    cleaned = _remove_shade(img, lo, hi)
    _, buf = cv2.imencode(".jpg", cleaned)
    return io.BytesIO(buf)


def _process_pdf(file_bytes, lo, hi):
    import cv2
    import numpy as np
    from pdf2image import convert_from_bytes
    from PIL import Image

    pages = convert_from_bytes(file_bytes, dpi=200)
    cleaned_pages = []

    for p in pages:
        bgr = cv2.cvtColor(np.array(p), cv2.COLOR_RGB2BGR)
        cleaned = _remove_shade(bgr, lo, hi)
        rgb = cv2.cvtColor(cleaned, cv2.COLOR_BGR2RGB)
        cleaned_pages.append(Image.fromarray(rgb))

    buf = io.BytesIO()
    cleaned_pages[0].save(
        buf, format="PDF", save_all=True,
        append_images=cleaned_pages[1:]
    )
    buf.seek(0)
    return buf
