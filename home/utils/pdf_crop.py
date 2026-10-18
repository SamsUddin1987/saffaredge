from django.shortcuts import render
from django.http import HttpResponse
from pypdf import PdfReader, PdfWriter
import io

def parse_range_string(range_str):
    """MODIFIED: New helper to handle '1, 2, 5-8' mixed formats."""
    selected_pages = set()
    if not range_str:
        return selected_pages
    parts = range_str.split(',')
    for part in parts:
        part = part.strip()
        if '-' in part: # Handles ranges like 5-10
            try:
                start, end = map(int, part.split('-'))
                selected_pages.update(range(start, end + 1))
            except ValueError: continue
        elif part.isdigit(): # Handles single pages
            selected_pages.add(int(part))
    return selected_pages

def handle_crop_request(request):
    if request.method == 'POST':
        file = request.FILES.get('pdf_file')
        if not file: # MODIFIED: Safety check to prevent 'NoneType' error
            return render(request, 'pdf/crop.html', {'error': 'No file uploaded'})

        action_mode = request.POST.get('action_mode', 'crop')
        m_left = float(request.POST.get('margin_left', 0))
        m_bottom = float(request.POST.get('margin_bottom', 0))
        m_right = float(request.POST.get('margin_right', 0))
        m_top = float(request.POST.get('margin_top', 0))
        
        # MODIFIED: Changed variable name to 'page_ranges' to match your requirement
        range_input = request.POST.get('page_ranges', "") 
        target_pages = parse_range_string(range_input)

        try:
            reader = PdfReader(file)
            writer = PdfWriter()

            for page_number, page in enumerate(reader.pages, start=1):
                # MODIFIED: Logic now processes ONLY the range, defaults to ALL if empty
                should_process = (not target_pages) or (page_number in target_pages)
                
                if should_process:
                    # MODIFIED: Use mediabox as absolute base to prevent "uncropping" bug
                    mb = page.mediabox
                    new_left = mb.left + m_left
                    new_bottom = mb.bottom + m_bottom
                    new_right = mb.right - m_right
                    new_top = mb.top - m_top

                    if action_mode == 'crop':
                        # MODIFIED: Syncing both boxes ensures the viewer physically resizes
                        page.mediabox.lower_left = (new_left, new_bottom)
                        page.mediabox.upper_right = (new_right, new_top)
                        page.cropbox.lower_left = (new_left, new_bottom)
                        page.cropbox.upper_right = (new_right, new_top)
                    else:
                        page.cropbox.lower_left = (new_left, new_bottom)
                        page.cropbox.upper_right = (new_right, new_top)

                writer.add_page(page)

            # MODIFIED: Added compression to attempt file size reduction
            for page in writer.pages:
                page.compress_content_streams() # This removes redundant data inside the stream

            buffer = io.BytesIO()
            writer.write(buffer)
            buffer.seek(0)

            response = HttpResponse(buffer.getvalue(), content_type='application/pdf')
            response['Content-Disposition'] = f'attachment; filename="{action_mode}_{file.name}"'
            return response

        except Exception as e:
            return render(request, 'pdf/crop.html', {'error': str(e)})

    return render(request, 'pdf/crop.html')