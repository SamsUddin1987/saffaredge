/* ==========================================
   Tab Switcher & Main Application Logic
   ========================================== */
function switchAppTab(tabType) {
    // 1. Hide all active workspace panes & tabs
    document.querySelectorAll('.app-pane').forEach(pane => pane.classList.remove('active'));
    document.querySelectorAll('.app-tab').forEach(tab => tab.classList.remove('active'));

    // 2. Activate target pane
    if (tabType === 'cad') {
        document.getElementById('cad-pane')?.classList.add('active');
        document.getElementById('tab-cad')?.classList.add('active');
        
        // Recalculate canvas proportions
        if (typeof onCADResize === 'function') {
            onCADResize();
        }
    } else if (tabType === 'spreadsheet') {
        document.getElementById('spreadsheet-pane')?.classList.add('active');
        document.getElementById('tab-spreadsheet')?.classList.add('active');

        // Initialize or trigger layout update on Luckysheet
        if (typeof initLuckysheet === 'function') {
            if (!isLuckysheetInitialized) {
                initLuckysheet();
            } else {
                window.dispatchEvent(new Event('resize'));
            }
        }
    }
}