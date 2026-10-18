from django.shortcuts import render
from django.http import HttpResponse
from pypdf import PdfWriter, PdfReader # 
import io

def handle_rotate_request(request):
    """Processes the request to rotate all pages in a PDF based on Rotate.pyw logic."""
    if request.method == 'POST':
        # Get the single file and the rotation angle from the form
        file = request.FILES.get('pdf_file')
        angle_input = request.POST.get('angle')
        
        if not file:
            return render(request, 'pdf/rotate.html', {'error': 'No file selected.'})
        if not angle_input:
            return render(request, 'pdf/rotate.html', {'error': 'Please select a rotation angle.'})

        try:
            angle = int(angle_input)
            writer = PdfWriter() # 
            reader = PdfReader(file) # 
            
            # Logic from Rotate.pyw: Loop through each page and rotate it 
            for page in reader.pages:
                page.rotate(angle) # 
                writer.add_page(page) # 

            # Write the result to an in-memory buffer 
            buffer = io.BytesIO()
            writer.write(buffer) # 
            writer.close()
            buffer.seek(0)
            
            # Prepare the download response
            response = HttpResponse(buffer, content_type='application/pdf')
            response['Content-Disposition'] = f'attachment; filename="rotated_{file.name}"'
            return response

        except Exception as e:
            return render(request, 'pdf/rotate.html', {'error': f'Error: {e}'})

    # GET request shows the initial form
    return render(request, 'pdf/rotate.html')