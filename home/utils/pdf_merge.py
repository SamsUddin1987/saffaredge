from django.shortcuts import render
from django.http import HttpResponse
from pypdf import PdfWriter, PdfReader # [cite: 1]
import io

def handle_merge_request(request):
    """Processes the web request and returns a Django response."""
    if request.method == 'POST':
        files = request.FILES.getlist('pdfs')
        
        if not files:
            return render(request, 'pdf/merge.html', {'error': 'No files selected.'})

        try:
            # Create the PDF in memory
            merged_buffer = _process_pdf_merging(files) # 

            # Prepare the download response
            response = HttpResponse(merged_buffer, content_type='application/pdf')
            response['Content-Disposition'] = 'attachment; filename="merged_document.pdf"'
            return response

        except Exception as e:
            return render(request, 'pdf/merge.html', {'error': f'Error: {e}'})

    # GET request just shows the page
    return render(request, 'pdf/merge.html')

def _process_pdf_merging(files):
    """The internal logic you originally wrote[cite: 1]."""
    writer = PdfWriter() # [cite: 1]
    
    for f in files:
        reader = PdfReader(f) # 
        
        if reader.is_encrypted: # 
            try:
                reader.decrypt("") # 
            except:
                continue # [cite: 3]

        for page in reader.pages: # [cite: 3]
            writer.add_page(page) # [cite: 3]

    buffer = io.BytesIO()
    writer.write(buffer) # 
    writer.close() # 
    buffer.seek(0)
    return buffer