from django.shortcuts import render
from django.http import HttpResponse
from pypdf import PdfWriter, PdfReader
import io

def handle_split_request(request):
    """Processes the web request to split a PDF based on page range."""
    if request.method == 'POST':
        file = request.FILES.get('pdfs')
        start_input = request.POST.get('start_page')
        end_input = request.POST.get('end_page')
        
        if not file:
            return render(request, 'pdf/split.html', {'error': 'No file selected.'})
        if not start_input or not end_input:
            return render(request, 'pdf/split.html', {'error': 'Please provide start and end pages.'})

        try:
            # Convert inputs to integers (1-based index from user to 0-based)
            start = int(start_input) - 1 
            end = int(end_input) 

            writer = PdfWriter()
            reader = PdfReader(file)
            
            # Loop through the specific range
            for page_num in range(start, end):
                writer.add_page(reader.pages[page_num])

            buffer = io.BytesIO()
            writer.write(buffer)
            writer.close()
            buffer.seek(0)
            
            response = HttpResponse(buffer, content_type='application/pdf')
            response['Content-Disposition'] = f'attachment; filename="split_{file.name}"'
            return response

        except IndexError:
            return render(request, 'pdf/split.html', {'error': 'Page range is out of bounds.'})
        except Exception as e:
            return render(request, 'pdf/split.html', {'error': f'Error: {e}'})

    return render(request, 'pdf/split.html')