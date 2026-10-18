import json
from django.shortcuts import render
from django.http import HttpResponse, JsonResponse

# PDF UTILITIES
from .utils.pdf_merge import handle_merge_request
from .utils.pdf_split import handle_split_request
from .utils.pdf_rotate import handle_rotate_request
from .utils.pdf_crop import handle_crop_request
from .utils.pdf_unlock import handle_unlock_request
from .utils.pdf_lock import handle_lock_request
from .utils.pdf_shade import handle_shade_request, save_shade_sample

# =========================
# GENERAL PAGES
# =========================

def home(request):
    return render(request, "home.html")

def about(request):
    return render(request, "about.html")

def assistant(request):
    return render(request, "assistant.html")

# =========================
# UNIFIED ESTIMATION & CAD WORKSPACE
# =========================

def workspace_view(request, tool_type='cad_default'):
    title_map = {
        'cad_default': 'CAD & Sheet Workspace',
        'footing': 'Footing Estimation',
        'beam': 'Beam Estimation',
        'column': 'Column Estimation',
        'slab': 'Slab Estimation',
        'retaining_wall': 'Retaining Wall Estimation',
        'sample': 'Sample Estimation',
    }
    
    context = {
        'tool_title': title_map.get(tool_type, 'CAD Workspace'),
        'tool_type': tool_type,
    }
    
    # Unified template for both CAD & Estimation submenus
    return render(request, 'cad_workspace.html', context)

# Backward-compatibility alias (in case legacy URLs call cad_workspace)
cad_workspace = workspace_view

# =========================
# QA/QC
# =========================

def qaqc_moisture(request):
    return render(request, "qaqc/moisture.html")

def qaqc_sieve(request):
    return render(request, "qaqc/sieve.html")

def qaqc_cube(request):
    return render(request, "qaqc/cube.html")

def qaqc_silt(request):
    return render(request, "qaqc/silt.html")

def qaqc_bulkage(request):
    return render(request, "qaqc/bulkage.html")

# =========================
# SURVEY
# =========================

def sur_sympson(request):
    return render(request, "survey/sympson.html")

def sur_area(request):
    return render(request, "survey/area.html")

# =========================
# CIVIL APTITUDE
# =========================

def apt_weight(request):
    return render(request, "aptitude/weight.html")

def apt_area(request):
    return render(request, "aptitude/area.html")

def apt_volume(request):
    return render(request, "aptitude/volume.html")

# =========================
# PDF TOOLS
# =========================

def pdf_merge(request):
    return handle_merge_request(request)

def pdf_split(request):
    return handle_split_request(request)

def pdf_rotate(request):
    return handle_rotate_request(request)

def pdf_crop(request):
    return handle_crop_request(request)

def pdf_unlock(request):
    return handle_unlock_request(request)

def pdf_lock(request):
    return handle_lock_request(request)

def pdf_shade(request):
    return handle_shade_request(request)

# =========================
# UTILS
# =========================

def pdf_save_shade(request):
    return save_shade_sample(request)

def download_file(request):
    return HttpResponse("Download is handled via the Merge button.")