/* ==========================================
   Spreadsheet Engine (Luckysheet)
   ========================================== */
let isLuckysheetInitialized = false;

function initLuckysheet() {
    if (isLuckysheetInitialized) return;

    luckysheet.create({
        container: 'luckysheet', // Matches div ID in HTML
        title: 'Engineering Calculation Sheet',
        lang: 'en',
        showinfobar: false,
        data: [{
            name: 'Sheet1',
            status: '1',
            order: '0',
            data: [],
            config: {}
        }]
    });

    isLuckysheetInitialized = true;
}