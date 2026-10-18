from django.shortcuts import render
from django.http import HttpResponse
from pypdf import PdfWriter, PdfReader
import io


def handle_lock_request(request):
    """
    Protects (locks) a PDF with a password and returns the encrypted file.
    """
    if request.method == "POST":
        pdf_file = request.FILES.get("pdfs")
        password = request.POST.get("password")

        if not pdf_file:
            return render(request, "pdf/lock.html", {"error": "No file selected."})

        if not password:
            return render(request, "pdf/lock.html", {"error": "Password is required."})

        try:
            buffer = _process_pdf_locking(pdf_file, password)

            response = HttpResponse(
                buffer.getvalue(),
                content_type="application/pdf"
            )
            response["Content-Disposition"] = (
                f'attachment; filename="locked_{pdf_file.name}"'
            )
            return response

        except Exception as e:
            return render(
                request,
                "pdf/lock.html",
                {"error": f"Unable to protect PDF: {e}"}
            )

    return render(request, "pdf/lock.html")


def _process_pdf_locking(file, password):
    """
    Encrypts a PDF using the provided password.
    """
    reader = PdfReader(file)
    writer = PdfWriter()

    # Copy pages
    for page in reader.pages:
        writer.add_page(page)

    # 🔐 PROTECT PDF WITH PASSWORD
    writer.encrypt(password)

    buffer = io.BytesIO()
    writer.write(buffer)
    buffer.seek(0)

    return buffer