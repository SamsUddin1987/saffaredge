from django.shortcuts import render
from django.http import HttpResponse
from pypdf import PdfWriter, PdfReader # 
import io

def handle_unlock_request(request):
    """Processes the unlocking request and returns the decrypted PDF."""
    if request.method == 'POST':
        # Retrieve the file and the password from the POST request
        pdf_file = request.FILES.get('pdfs')
        password = request.POST.get('password') # 
        
        if not pdf_file:
            return render(request, 'pdf/unlock.html', {'error': 'No file selected.'})
        
        if not password:
            return render(request, 'pdf/unlock.html', {'error': 'Password is required.'})

        try:
            # Create the unencrypted PDF in memory
            unlocked_buffer = _process_pdf_unlocking(pdf_file, password) # 

            # Prepare the download response
            response = HttpResponse(unlocked_buffer, content_type='application/pdf')
            response['Content-Disposition'] = f'attachment; filename="unlocked_{pdf_file.name}"'
            return response

        except Exception as e:
            return render(request, 'pdf/unlock.html', {'error': f'Invalid Password or Error: {e}'})

    # GET request shows the initial form
    return render(request, 'pdf/unlock.html')

def _process_pdf_unlocking(file, password):
    """Internal logic to decrypt the PDF and write to a buffer."""
    reader = PdfReader(file) # 
    
    # Decrypt the reader object using the provided password 
    if reader.is_encrypted:
        reader.decrypt(password) # 

    writer = PdfWriter() # 
    
    # Iterate through all pages of the decrypted file 
    for page in reader.pages: # 
        writer.add_page(page) # 

    buffer = io.BytesIO()
    writer.write(buffer) # 
    writer.close()
    buffer.seek(0)
    return buffer