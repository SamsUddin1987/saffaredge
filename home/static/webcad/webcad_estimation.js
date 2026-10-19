/* ================================================================
   WEBCAD ESTIMATION — India house estimate (INR)
   ----------------------------------------------------------------
   1. Reads the live 2D drawing (window.ArchitectSAFCore.getEntities()).
   2. Finds walls, rooms, floor areas, perimeters.
   3. Builds a complete house bill of quantities (foundation, brickwork,
      RCC frame, plaster, paint, flooring, doors, windows, electrical,
      plumbing) from those quantities and the mix ratios below.
   4. Prices every line with INR rates × city multiplier.
   5. Writes three Luckysheet sheets: Estimate (live formulas),
      Walls and Rooms. Cell colours come from the CAD theme variables.

   RATES ARE INDICATIVE 2025–26 BASE RATES, NOT QUOTES. Check them against
   your local market and edit the RATES table below or the sheet itself.
   ================================================================ */
(function () {
    'use strict';

    const NS = window.WebCADEstimation = window.WebCADEstimation || {};
    const MM_PER_M = 1000;
    const SQFT_PER_M2 = 10.7639;
    const LS_BASE = 'https://cdn.jsdelivr.net/npm/luckysheet@2.1.13/dist/';
    const LS_CSS = ['plugins/css/pluginsCss.css', 'plugins/plugins.css', 'css/luckysheet.css', 'assets/iconfont/iconfont.css'];
    const LS_JS = ['plugins/js/plugin.js', 'luckysheet.umd.js'];
    const CSS_HREF = './webcad-estimation.css';

    // ---------------------------------------------------------------
    // City multipliers applied to every rate (1.00 = base)
    // ---------------------------------------------------------------
    const ZONES = {
        'Kolkata': 1.00, 'Mumbai': 1.20, 'Delhi NCR': 1.15, 'Bengaluru': 1.10,
        'Chennai': 1.07, 'Hyderabad': 1.06, 'Pune': 1.09, 'Ahmedabad': 1.03,
        'Jaipur': 0.98, 'Lucknow': 0.97, 'Patna': 0.95, 'Guwahati': 1.02,
        'Bhubaneswar': 0.98, 'Other (base rates)': 1.00
    };

    // ---------------------------------------------------------------
    // Mix and material constants (Indian site practice)
    // ---------------------------------------------------------------
    const BRICKS_PER_M3 = 500;         // 190 x 90 x 90 mm clay brick with 10 mm joints
    const MORTAR_PER_M3_BRICK = 0.23;  // m³ of mortar per m³ of brickwork
    const DRY_FACTOR = 1.27;           // dry volume / wet volume for cement mortar
    const CEMENT_DENSITY = 1440;       // kg/m³ loose cement
    const CEMENT_BAG_KG = 50;
    const STEEL_KG_PER_M3 = 95;        // TMT Fe500 in RCC (footing, beams, slab, columns)

    // Converts a mortar volume and mix (cement:sand parts) into cement bags and sand m³.
    function mortar(volumeM3, cementParts, sandParts) {
        const dry = volumeM3 * DRY_FACTOR;
        const cementM3 = dry * cementParts / (cementParts + sandParts);
        return {
            bags: cementM3 * CEMENT_DENSITY / CEMENT_BAG_KG,
            sandM3: dry - cementM3
        };
    }
    const COEF = {
        brick: mortar(MORTAR_PER_M3_BRICK, 1, 6),   // per m³ brickwork (1:6)
        plaster: mortar(0.012, 1, 4),                // per m² of 12 mm plaster (1:4)
        bedding: mortar(0.04, 1, 4)                  // per m² of 40 mm floor bedding (1:4)
    };

    // ---------------------------------------------------------------
    // Base INR rates (material and labour, per unit).
    // ---------------------------------------------------------------
    // Base material rates in ₹ per unit, before the city multiplier (indicative 2025–26).
    const RATES = {
        cement: 420, sand: 2600, brick: 8.5, rmc: 6300, footingRmc: 6300, steel: 62, formwork: 120,
        waterproof: 165, antiTermite: 28, pop: 95, putty: 22, paint: 320, tile: 650, adhesive: 25,
        skirting: 130, door: 7500, window: 5500, eletPoint: 650, dbBoard: 14000, bathSet: 38000,
        kitchenSink: 12000, plumbRoom: 3500
    };

    // Daily wages in ₹ for an 8-hour day, before the city multiplier.
    // Market figures are from published 2026 India construction wage guides (ranges). Where a
    // trade has no published figure, the source says "Assumed".
    const TRADES = [
        { id: 'mason',       name: 'Mason (skilled)',               wage: 800,  source: 'Market ₹600–1,200/day' },
        { id: 'helper',      name: 'Helper / mazdoor (unskilled)',  wage: 550,  source: 'Market ₹450–750/day' },
        { id: 'carpenter',   name: 'Carpenter (shuttering, doors)', wage: 850,  source: 'Market ₹800–1,100/day' },
        { id: 'bender',      name: 'Bar bender / steel fixer',      wage: 800,  source: 'Assumed, close to carpenter' },
        { id: 'electrician', name: 'Electrician',                   wage: 900,  source: 'Market ₹750–1,300/day' },
        { id: 'plumber',     name: 'Plumber',                       wage: 900,  source: 'Market ₹700–1,300/day' },
        { id: 'painter',     name: 'Painter',                       wage: 800,  source: 'Market ₹700–1,000/day' },
        { id: 'tiler',       name: 'Tile layer',                    wage: 850,  source: 'Assumed, close to mason' },
        { id: 'waterproofer',name: 'Waterproofing applicator',      wage: 800,  source: 'Assumed' },
        { id: 'foreman',     name: 'Site foreman (supervisor)',     wage: 1200, source: 'Assumed. Contractor-mason ₹1,500–2,500/day' }
    ];
    const DEFAULTS = {
        zone: 'Kolkata',
        heightM: 3.0,            // clear wall height
        brickThickM: 0.23,       // 9 inch brick wall
        footingWidthM: 0.6,
        footingThickM: 0.45,
        excavationDepthM: 0.9,
        slabThickM: 0.125,
        colBeamM3PerRoom: 0.5,   // columns and beams concrete allowance per room
        pointsPerRoom: 6,
        bathrooms: null,         // null = automatic (about one per 4 rooms, minimum 1)
        kitchens: 1,
        doors: null,             // null = one per room
        windows: null,           // null = one per room
        workingDays: 180,        // site duration in working days (used for headcount)
        peakFactor: 1.25,        // peak headcount above the average
        contingencyPct: 5,
        overheadPct: 10,
        gstPct: 12,
        snapMm: 10
    };
    const state = {
        open: false,
        full: false,
        settings: Object.assign({}, DEFAULTS),
        lsReady: null,
        sheetCreated: false,
        lastResult: null
    };

    // ---------------------------------------------------------------
    // Geometry from the CAD drawing (pure logic)
    // ---------------------------------------------------------------
    const CURVE_SEGMENTS = 64;

    function curvePoints(cx, cy, r, a0, a1, closed) {
        const pts = [];
        const n = closed ? CURVE_SEGMENTS : Math.max(2, Math.ceil(CURVE_SEGMENTS * Math.abs(a1 - a0) / (2 * Math.PI)));
        for (let i = 0; i <= n; i++) {
            if (closed && i === n) break;
            const a = a0 + (a1 - a0) * (i / n);
            pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
        }
        return pts;
    }

    /** segs = straight pieces for room detection. walls = priced wall items. skipped = unpriced types. */
    function segmentsFrom(entities) {
        const segs = [], walls = [], skipped = {};
        const addSeg = (x1, y1, x2, y2) => segs.push({ x1, y1, x2, y2 });
        const addWall = (x1, y1, x2, y2) => walls.push({ lengthMm: Math.hypot(x2 - x1, y2 - y1), kind: 'Wall' });

        entities.forEach((e) => {
            if (e.type === 'line' && [e.x, e.y, e.x2, e.y2].every(Number.isFinite)) {
                addSeg(e.x, e.y, e.x2, e.y2); addWall(e.x, e.y, e.x2, e.y2);
            } else if (e.type === 'polyline' && Array.isArray(e.points) && e.points.length > 1) {
                const p = e.points;
                for (let i = 1; i < p.length; i++) { addSeg(p[i - 1].x, p[i - 1].y, p[i].x, p[i].y); addWall(p[i - 1].x, p[i - 1].y, p[i].x, p[i].y); }
                if (e.closed && p.length > 2) { addSeg(p[p.length - 1].x, p[p.length - 1].y, p[0].x, p[0].y); addWall(p[p.length - 1].x, p[p.length - 1].y, p[0].x, p[0].y); }
            } else if (e.type === 'rect' && [e.x, e.y, e.w, e.h].every(Number.isFinite)) {
                const c = [[e.x, e.y], [e.x + e.w, e.y], [e.x + e.w, e.y + e.h], [e.x, e.y + e.h]];
                for (let i = 0; i < 4; i++) { const [ax, ay] = c[i], [bx, by] = c[(i + 1) % 4]; addSeg(ax, ay, bx, by); addWall(ax, ay, bx, by); }
            } else if (e.type === 'circle' && [e.x, e.y, e.radius].every(Number.isFinite) && e.radius > 0) {
                const pts = curvePoints(e.x, e.y, e.radius, 0, 2 * Math.PI, true);
                for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; addSeg(a.x, a.y, b.x, b.y); }
                walls.push({ lengthMm: 2 * Math.PI * e.radius, kind: 'Circle wall' });
            } else if (e.type === 'arc' && [e.x, e.y, e.radius].every(Number.isFinite) && e.radius > 0) {
                const a0 = e.startAngle || 0, a1 = e.endAngle === undefined ? Math.PI : e.endAngle;
                const pts = curvePoints(e.x, e.y, e.radius, a0, a1, false);
                for (let i = 1; i < pts.length; i++) addSeg(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
                walls.push({ lengthMm: e.radius * Math.abs(a1 - a0), kind: 'Arc wall' });
            } else {
                skipped[e.type] = (skipped[e.type] || 0) + 1;
            }
        });
        return { segs, walls, skipped };
    }

    /** Splits each segment where another segment's endpoint touches it (T-junctions). */
    function splitAtJunctions(segs, snap) {
        const out = [];
        segs.forEach((s, i) => {
            const dx = s.x2 - s.x1, dy = s.y2 - s.y1, len2 = dx * dx + dy * dy;
            const ts = [0, 1];
            if (len2 > 0) {
                segs.forEach((o, j) => {
                    if (j === i) return;
                    [[o.x1, o.y1], [o.x2, o.y2]].forEach(([px, py]) => {
                        const t = ((px - s.x1) * dx + (py - s.y1) * dy) / len2;
                        if (t <= 1e-9 || t >= 1 - 1e-9) return;
                        if (Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy)) <= snap) ts.push(t);
                    });
                });
            }
            ts.sort((a, b) => a - b);
            for (let k = 1; k < ts.length; k++) {
                const a = ts[k - 1], b = ts[k];
                out.push({ x1: s.x1 + a * dx, y1: s.y1 + a * dy, x2: s.x1 + b * dx, y2: s.y1 + b * dy });
            }
        });
        return out;
    }

    /** Undirected planar graph with grid-hashed vertex welding. */
    function buildPlanarGraph(segs, snap) {
        const nodes = [], cells = new Map();
        const nodeAt = (x, y) => {
            const ix = Math.floor(x / snap), iy = Math.floor(y / snap);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                const ids = cells.get((ix + dx) + ',' + (iy + dy));
                if (!ids) continue;
                for (const id of ids) if (Math.hypot(nodes[id].x - x, nodes[id].y - y) <= snap) return id;
            }
            const id = nodes.length;
            nodes.push({ x, y, adj: [] });
            const key = ix + ',' + iy;
            if (!cells.has(key)) cells.set(key, []);
            cells.get(key).push(id);
            return id;
        };
        const edgeSet = new Set();
        segs.forEach((s) => {
            const a = nodeAt(s.x1, s.y1), b = nodeAt(s.x2, s.y2);
            if (a === b) return;
            const k = a < b ? a + '-' + b : b + '-' + a;
            if (edgeSet.has(k)) return;
            edgeSet.add(k);
            nodes[a].adj.push(b);
            nodes[b].adj.push(a);
        });
        nodes.forEach((n) => {
            n.adj.sort((p, q) =>
                Math.atan2(nodes[p].y - n.y, nodes[p].x - n.x) - Math.atan2(nodes[q].y - n.y, nodes[q].x - n.x));
        });
        return nodes;
    }

    function signedAreaMm2(pts) {
        let s = 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            s += p.x * q.y - q.x * p.y;
        }
        return s / 2;
    }

    /** Every bounded face of the wall network is a room. The outer boundary is excluded. */
    function detectRooms(segs, snapMm) {
        const nodes = buildPlanarGraph(splitAtJunctions(segs, snapMm), snapMm);
        const visited = new Set();
        const rooms = [];
        for (let u = 0; u < nodes.length; u++) {
            for (const v of nodes[u].adj) {
                if (visited.has(u + '>' + v)) continue;
                const loop = [];
                let a = u, b = v, guard = 0, closed = false;
                while (guard++ < 100000) {
                    visited.add(a + '>' + b);
                    loop.push({ x: nodes[a].x, y: nodes[a].y });
                    const nb = nodes[b].adj;
                    const i = nb.indexOf(a);
                    const next = nb[(i - 1 + nb.length) % nb.length];
                    a = b; b = next;
                    if (a === u && b === v) { closed = true; break; }
                }
                if (closed && loop.length >= 3 && signedAreaMm2(loop) > 0) rooms.push(loop);
            }
        }
        return rooms;
    }

    function polygonAreaMm2(pts) { return Math.abs(signedAreaMm2(pts)); }
    function polygonPerimeterMm(pts) {
        let s = 0;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            s += Math.hypot(q.x - p.x, q.y - p.y);
        }
        return s;
    }

    /** Geometry summary used by every quantity. All lengths in metres, areas in m². */
    function measureDrawing(entities, snapMm) {
        const { segs, walls, skipped } = segmentsFrom(entities);
        const loops = detectRooms(segs, snapMm);
        const rooms = loops.map((loop, i) => ({
            name: 'Room ' + (i + 1),
            areaM2: polygonAreaMm2(loop) / (MM_PER_M * MM_PER_M),
            perimeterM: polygonPerimeterMm(loop) / MM_PER_M
        }));
        const wallItems = walls
            .filter((w) => w.lengthMm > 0)
            .map((w, i) => ({ label: w.kind + ' ' + (i + 1), lengthM: w.lengthMm / MM_PER_M }));
        return {
            walls: wallItems,
            rooms,
            skipped,
            wallLengthM: wallItems.reduce((s, w) => s + w.lengthM, 0),
            floorAreaM2: rooms.reduce((s, r) => s + r.areaM2, 0),
            perimeterM: rooms.reduce((s, r) => s + r.perimeterM, 0)
        };
    }

    // ---------------------------------------------------------------
    // Quantities and the bill of quantities (pure logic)
    // ---------------------------------------------------------------
    function quantities(g, s) {
        const L = g.wallLengthM, H = s.heightM, brickT = s.brickThickM;
        const floor = g.floorAreaM2, rooms = g.rooms.length;
        const wallVol = L * H * brickT;          // m³ brickwork
        const wallArea = L * H;                  // m² one face
        const plasterArea = wallArea * 2;        // both faces
        const footConc = L * s.footingWidthM * s.footingThickM;
        const excav = L * s.footingWidthM * s.excavationDepthM;
        const slab = floor * s.slabThickM;
        const colBeam = rooms * s.colBeamM3PerRoom;
        const tiles = floor * 1.07;              // 7 % wastage
        const bathrooms = rooms === 0 ? 0 : (s.bathrooms !== null ? s.bathrooms : Math.max(1, Math.round(rooms / 4)));
        const doors = s.doors !== null ? s.doors : rooms;
        const windows = s.windows !== null ? s.windows : rooms;
        return {
            wallLengthM: L, heightM: H, brickThickM: brickT, rooms, floorAreaM2: floor,
            perimeterM: g.perimeterM, wallVolM3: wallVol, wallAreaM2: wallArea, plasterAreaM2: plasterArea,
            footConcM3: footConc, excavM3: excav, slabM3: slab, colBeamM3: colBeam,
            rccM3: slab + colBeam, steelKg: (footConc + slab + colBeam) * STEEL_KG_PER_M3,
            formworkM2: floor * 1.05 + colBeam * 6,
            bricks: wallVol * BRICKS_PER_M3,
            brickCement: wallVol * COEF.brick.bags, brickSandM3: wallVol * COEF.brick.sandM3,
            plasterCement: plasterArea * COEF.plaster.bags, plasterSandM3: plasterArea * COEF.plaster.sandM3,
            beddingCement: floor * COEF.bedding.bags, beddingSandM3: floor * COEF.bedding.sandM3,
            tilesM2: tiles, adhesiveKg: tiles * 5,
            paintLitres: (plasterArea + floor) * 0.2,
            paintAreaM2: plasterArea + floor,
            points: rooms * s.pointsPerRoom,
            doors, windows, bathrooms,
            kitchens: rooms === 0 ? 0 : s.kitchens,
            duration: rooms > 0 ? s.workingDays : 0
        };
    }

    /**
     * Full house bill. Each line: group, item, unit, qty, base material rate, and labour norms.
     * Labour norms are [tradeId, labour-days per unit]. Days × daily wage gives the labour cost.
     * Norms come from published site output figures where available (for example, about 500 bricks
     * per mason-helper day, 10 m² plaster per day, 30–40 m² painting per day). Others are marked assumed.
     */
    function billOfQuantities(q) {
        const SF = 'Site and foundation', MS = 'Masonry', RCC = 'RCC frame and slab',
            PF = 'Plaster and finishes', FL = 'Flooring', DW = 'Doors and windows',
            EL = 'Electrical', PL = 'Plumbing and sanitary';
        return [
            { group: SF, item: 'Excavation for foundation trench', unit: 'm³', qty: q.excavM3, mat: 0, lab: [['helper', 0.3]], note: 'About 3–4 m³ per helper-day in soft soil' },
            { group: SF, item: 'Anti-termite treatment on plinth', unit: 'm²', qty: q.floorAreaM2, mat: RATES.antiTermite, lab: [['helper', 0.02]], note: 'Assumed output' },
            { group: SF, item: 'Footing concrete M20 (ready-mix)', unit: 'm³', qty: q.footConcM3, mat: RATES.footingRmc, lab: [['mason', 0.5], ['helper', 1]], note: 'Strip footing under all walls' },
            { group: SF, item: 'Site foreman for the project duration', unit: 'day', qty: q.duration, qtyFromDuration: true, mat: 0, lab: [['foreman', 1]], note: 'One supervisor for every working day' },

            { group: MS, item: 'Clay bricks 190 × 90 × 90 mm', unit: 'nos', qty: q.bricks, mat: RATES.brick, lab: [], note: 'About 500 bricks per m³' },
            { group: MS, item: 'Brickwork masonry labour', unit: 'm³', qty: q.wallVolM3, mat: 0, lab: [['mason', 1], ['helper', 1]], note: 'About 500 bricks per mason-helper day' },
            { group: MS, item: 'Cement for brick mortar (1:6)', unit: 'bag', qty: q.brickCement, mat: RATES.cement, lab: [], note: '50 kg bags' },
            { group: MS, item: 'River sand for brick mortar (1:6)', unit: 'm³', qty: q.brickSandM3, mat: RATES.sand, lab: [], note: '' },

            { group: RCC, item: 'RCC M20 for columns, beams and roof slab', unit: 'm³', qty: q.rccM3, mat: RATES.rmc, lab: [['mason', 0.5], ['helper', 1]], note: 'Ready-mix, laid and vibrated' },
            { group: RCC, item: 'TMT steel Fe500 reinforcement', unit: 'kg', qty: q.steelKg, mat: RATES.steel, lab: [['bender', 0.006], ['helper', 0.003]], note: '95 kg per m³ of concrete' },
            { group: RCC, item: 'Shuttering and formwork', unit: 'm²', qty: q.formworkM2, mat: RATES.formwork, lab: [['carpenter', 0.1], ['helper', 0.1]], note: 'About 10 m² per carpenter-day' },
            { group: RCC, item: 'Roof waterproofing (APP membrane)', unit: 'm²', qty: q.floorAreaM2, mat: RATES.waterproof, lab: [['waterproofer', 0.05], ['helper', 0.03]], note: 'Top of roof slab' },

            { group: PF, item: 'Cement for 12 mm plaster (1:4)', unit: 'bag', qty: q.plasterCement, mat: RATES.cement, lab: [], note: 'Both faces of walls' },
            { group: PF, item: 'River sand for 12 mm plaster (1:4)', unit: 'm³', qty: q.plasterSandM3, mat: RATES.sand, lab: [], note: '' },
            { group: PF, item: '12 mm plaster labour', unit: 'm²', qty: q.plasterAreaM2, mat: 0, lab: [['mason', 0.1], ['helper', 0.1]], note: 'About 10 m² per mason-helper day' },
            { group: PF, item: 'POP false ceiling 6 mm', unit: 'm²', qty: q.floorAreaM2, mat: RATES.pop, lab: [['mason', 0.15], ['helper', 0.15]], note: 'Assumed output' },
            { group: PF, item: 'Wall putty, 2 coats', unit: 'm²', qty: q.plasterAreaM2, mat: RATES.putty, lab: [['painter', 0.05]], note: 'Assumed output' },
            { group: PF, item: 'Interior emulsion paint, 2 coats', unit: 'litre', qty: q.paintLitres, mat: RATES.paint, lab: [], note: 'About 10 m² per litre per coat' },
            { group: PF, item: 'Painting labour', unit: 'm²', qty: q.paintAreaM2, mat: 0, lab: [['painter', 0.03]], note: 'About 30–40 m² per painter-day' },

            { group: FL, item: 'Vitrified floor tiles 600 × 600 mm', unit: 'm²', qty: q.tilesM2, mat: RATES.tile, lab: [['tiler', 0.09], ['helper', 0.09]], note: 'About 10–12 m² per tiler-helper day, 7% wastage' },
            { group: FL, item: 'Tile adhesive', unit: 'kg', qty: q.adhesiveKg, mat: RATES.adhesive, lab: [], note: '5 kg per m²' },
            { group: FL, item: 'Cement for floor bedding 40 mm (1:4)', unit: 'bag', qty: q.beddingCement, mat: RATES.cement, lab: [], note: '' },
            { group: FL, item: 'River sand for floor bedding (1:4)', unit: 'm³', qty: q.beddingSandM3, mat: RATES.sand, lab: [], note: '' },
            { group: FL, item: 'Tile skirting', unit: 'm', qty: q.perimeterM, mat: RATES.skirting, lab: [['tiler', 0.1], ['helper', 0.02]], note: 'Assumed output' },

            { group: DW, item: 'Wooden flush door with frame', unit: 'nos', qty: q.doors, mat: RATES.door, lab: [['carpenter', 0.5], ['helper', 0.5]], note: 'Fitting, set in Settings' },
            { group: DW, item: 'Aluminium sliding window 4 × 3 ft', unit: 'nos', qty: q.windows, mat: RATES.window, lab: [['mason', 0.5], ['helper', 0.5]], note: 'Fixing, set in Settings' },

            { group: EL, item: 'Concealed electrical points', unit: 'nos', qty: q.points, mat: RATES.eletPoint, lab: [['electrician', 0.25], ['helper', 0.1]], note: 'Lights, fans, sockets, switches' },
            { group: EL, item: 'Distribution board and MCBs', unit: 'lump sum', qty: q.rooms ? 1 : 0, mat: RATES.dbBoard, lab: [['electrician', 1.5], ['helper', 0.5]], note: '' },

            { group: PL, item: 'Bathroom sanitary set (WC, basin, shower, CP)', unit: 'nos', qty: q.bathrooms, mat: RATES.bathSet, lab: [['plumber', 2], ['helper', 1]], note: 'Set in Settings' },
            { group: PL, item: 'Kitchen sink and tap', unit: 'nos', qty: q.kitchens, mat: RATES.kitchenSink, lab: [['plumber', 0.5], ['helper', 0.5]], note: 'Set in Settings' },
            { group: PL, item: 'Water supply and drainage piping per room', unit: 'nos', qty: q.rooms, mat: RATES.plumbRoom, lab: [['plumber', 1], ['helper', 1]], note: 'One per room' }
        ];
    }

    // ---------------------------------------------------------------
    // Settings and the complete pricing run (pure logic)
    // ---------------------------------------------------------------
    function zoneFactor(zone) { return ZONES[zone] || 1; }

    /** Full estimate: geometry → quantities → priced lines, labour days and headcount → totals. */
    function estimate(entities, settings) {
        const s = Object.assign({}, DEFAULTS, settings || {});
        const g = measureDrawing(entities, s.snapMm);
        const q = quantities(g, s);
        const f = zoneFactor(s.zone);
        const wage = {};
        TRADES.forEach((t) => { wage[t.id] = t.wage * f; });
        const days = {};
        TRADES.forEach((t) => { days[t.id] = 0; });

        const lines = billOfQuantities(q).map((l) => {
            l.lab.forEach(([id, d]) => { days[id] += l.qty * d; });
            const labPerUnit = l.lab.reduce((t, [id, d]) => t + d * wage[id], 0);
            const mat = l.mat * f;
            return {
                group: l.group, item: l.item, unit: l.unit, qty: l.qty,
                matBase: l.mat, mat, lab: labPerUnit, matAmt: l.qty * mat, labAmt: l.qty * labPerUnit,
                norms: l.lab, qtyFromDuration: !!l.qtyFromDuration, note: l.note
            };
        });

        const trades = TRADES.map((t) => {
            const d = days[t.id];
            const avg = s.workingDays > 0 ? Math.ceil(d / s.workingDays) : 0;
            const peak = s.workingDays > 0 ? Math.max(avg, Math.round((d / s.workingDays) * s.peakFactor)) : 0;
            return { id: t.id, name: t.name, baseWage: t.wage, wage: wage[t.id], days: d,
                cost: d * wage[t.id], avg, peak, source: t.source };
        });
        const labour = {
            days: trades.reduce((t, x) => t + x.days, 0),
            cost: trades.reduce((t, x) => t + x.cost, 0),
            avg: trades.reduce((t, x) => t + x.avg, 0),
            peak: trades.reduce((t, x) => t + x.peak, 0)
        };

        const direct = lines.reduce((t, l) => t + l.matAmt + l.labAmt, 0);
        const contingency = direct * s.contingencyPct / 100;
        const overhead = (direct + contingency) * s.overheadPct / 100;
        const gst = (direct + contingency + overhead) * s.gstPct / 100;
        const grand = direct + contingency + overhead + gst;
        return {
            settings: s, geometry: g, quantities: q, lines, trades, labour, zoneFactor: f,
            totals: { direct, contingency, overhead, gst, grand, perM2: g.floorAreaM2 > 0 ? grand / g.floorAreaM2 : 0 }
        };
    }

    const GROUP_ORDER = ['Site and foundation', 'Masonry', 'RCC frame and slab', 'Plaster and finishes',
        'Flooring', 'Doors and windows', 'Electrical', 'Plumbing and sanitary'];

    // ---------------------------------------------------------------
    // Luckysheet: palette from the CAD theme, sheet builders
    // ---------------------------------------------------------------
    function palette() {
        const cs = getComputedStyle(document.body);
        const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
        return {
            bg: v('--bg-secondary', '#ffffff'),
            alt: v('--bg-tertiary', '#f4f6fa'),
            text: v('--text-primary', '#0f172a'),
            muted: v('--text-muted', '#64748b'),
            accent: v('--accent-indigo', '#4f46e5'),
            soft: v('--accent-soft', '#eef2ff'),
            border: v('--border-color', '#e2e8f0'),
            white: '#ffffff'
        };
    }

    const FMT_MONEY = { fa: '#,##0.00', t: 'n' };
    const FMT_QTY = { fa: '#,##0.000', t: 'n' };
    const FMT_PCT = { fa: '0.0%', t: 'n' };

    /** Cell builder. value may be a number, text, or {f, v} for a formula. */
    function cell(r, c, value, style, fmt) {
        const v = {};
        if (value && typeof value === 'object' && value.f) { v.f = value.f; v.v = value.v; }
        else v.v = value;
        if (fmt) v.ct = fmt;
        if (style) Object.assign(v, style);
        return { r, c, v };
    }

    function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

    function colLetter(c) { return String.fromCharCode(65 + c); }
    function ref(r, c) { return colLetter(c) + (r + 1); }

    function estimateSheet(res, pal) {
        const S = res.settings;
        const cells = [], borders = [], merges = {};
        // Store exact values. The number format rounds what is displayed, so formulas stay exact.
        const money = (n) => n;
        const st = {
            title: { bg: pal.accent, fc: pal.white, bl: 1, fs: 15, ht: 1, vt: 1 },
            subtitle: { bg: pal.soft, fc: pal.muted, fs: 9, ht: 1, vt: 1 },
            section: { fc: pal.accent, bl: 1, fs: 10, vt: 1 },
            setLabel: { bg: pal.alt, fc: pal.text, fs: 10, vt: 1 },
            setValue: { bg: pal.bg, fc: pal.accent, bl: 1, fs: 10, ht: 2, vt: 1 },
            header: { bg: pal.accent, fc: pal.white, bl: 1, fs: 10, ht: 1, vt: 1 },
            group: { bg: pal.soft, fc: pal.accent, bl: 1, fs: 10, vt: 1 },
            numRow: { fc: pal.text, fs: 10, ht: 2, vt: 1 },
            txtRow: { fc: pal.text, fs: 10, ht: 0, vt: 1 },
            noteRow: { fc: pal.muted, fs: 9, ht: 0, vt: 1 },
            sub: { bg: pal.alt, fc: pal.text, bl: 1, fs: 10, ht: 2, vt: 1 },
            subLabel: { bg: pal.alt, fc: pal.text, bl: 1, fs: 10, ht: 0, vt: 1 },
            direct: { bg: pal.soft, fc: pal.accent, bl: 1, fs: 10, ht: 2, vt: 1 },
            directLabel: { bg: pal.soft, fc: pal.accent, bl: 1, fs: 10, ht: 0, vt: 1 },
            grand: { bg: pal.accent, fc: pal.white, bl: 1, fs: 12, ht: 2, vt: 1 },
            grandLabel: { bg: pal.accent, fc: pal.white, bl: 1, fs: 12, ht: 0, vt: 1 }
        };
        const A = (r, c) => '$' + colLetter(c) + '$' + (r + 1);   // absolute reference

        // Fixed row plan
        const R = { zone: 4, duration: 5, peak: 6, cont: 7, oh: 8, gst: 9, floor: 10,
            labSection: 12, labHead: 13, labFirst: 14 };
        R.labTotal = R.labFirst + TRADES.length;
        R.bomSection = R.labTotal + 2;
        R.head = R.bomSection + 1;
        const tradeRow = {};
        TRADES.forEach((t, i) => { tradeRow[t.id] = R.labFirst + i; });

        // Plan the bill rows first, so labour formulas can point at quantity cells.
        const itemRow = new Map();
        const groups = [];
        let r = R.head + 1;
        GROUP_ORDER.forEach((gname, gi) => {
            const lines = res.lines.filter((l) => l.group === gname);
            if (!lines.length) return;
            const headRow = r++;
            const first = r;
            lines.forEach((l) => { itemRow.set(l, r++); });
            groups.push({ gname, gi, headRow, first, last: r - 1, lines, subRow: r++ });
        });
        const tableEnd = r - 1;

        // Title and subtitle
        cells.push(cell(0, 0, 'CivilArch Estimate — India (INR)', st.title));
        cells.push(cell(1, 0, `Zone: ${S.zone} (×${res.zoneFactor.toFixed(2)})  ·  Indicative 2025–26 rates  ·  Blue cells are editable  ·  Quantities from your drawing`, st.subtitle));
        merges['0_0'] = { r: 0, c: 0, rs: 1, cs: 10 };
        merges['1_0'] = { r: 1, c: 0, rs: 1, cs: 10 };

        // Project settings
        cells.push(cell(3, 0, 'PROJECT SETTINGS', st.section));
        const setRow = (row, label, value, fmt) => {
            cells.push(cell(row, 1, label, st.setLabel));
            cells.push(cell(row, 3, value, st.setValue, fmt));
        };
        setRow(R.zone, 'City rate multiplier (Kolkata = 1.00)', res.zoneFactor, { fa: '0.00', t: 'n' });
        setRow(R.duration, 'Site duration (working days)', S.workingDays, { fa: '0', t: 'n' });
        setRow(R.peak, 'Peak labour factor (×average)', S.peakFactor, { fa: '0.00', t: 'n' });
        setRow(R.cont, 'Contingency (%)', S.contingencyPct / 100, FMT_PCT);
        setRow(R.oh, 'Overhead and profit (%)', S.overheadPct / 100, FMT_PCT);
        setRow(R.gst, 'GST on works contract (%)', S.gstPct / 100, FMT_PCT);
        setRow(R.floor, 'Floor area (m²)', money(res.geometry.floorAreaM2), FMT_QTY);

        // Labour table: daily wage, total labour days, cost and headcount per trade
        cells.push(cell(R.labSection, 0, 'LABOUR: DAILY WAGES, DAYS AND HEADCOUNT', st.section));
        ['', 'Trade', 'Base wage (₹/day)', 'Wage here (₹/day)', 'Total labour days', 'Labour cost (₹)',
            'Workers needed (average)', 'Workers needed (peak)', '', 'Wage source'].forEach((h, c) => {
            if (h) cells.push(cell(R.labHead, c, h, st.header));
        });
        const wageCell = (id) => A(tradeRow[id], 3);
        const dur = A(R.duration, 3), peakRef = A(R.peak, 3);
        TRADES.forEach((t, i) => {
            const row = R.labFirst + i;
            const tr = res.trades.find((x) => x.id === t.id);
            const termRefs = [];
            groups.forEach((g) => g.lines.forEach((l) => {
                l.norms.forEach(([id, d]) => { if (id === t.id) termRefs.push(`${ref(itemRow.get(l), 3)}*${d}`); });
            }));
            const dayFormula = termRefs.length ? '=' + termRefs.join('+') : '=0';
            const zebra = { bg: i % 2 === 0 ? pal.bg : pal.alt };
            cells.push(cell(row, 1, t.name, Object.assign({}, st.txtRow, zebra)));
            cells.push(cell(row, 2, t.wage, Object.assign({}, st.setValue, { bg: zebra.bg }), FMT_MONEY));
            cells.push(cell(row, 3, { f: `=${ref(row, 2)}*${A(R.zone, 3)}`, v: money(tr.wage) }, Object.assign({}, st.numRow, zebra), FMT_MONEY));
            cells.push(cell(row, 4, { f: dayFormula, v: money(tr.days) }, Object.assign({}, st.numRow, zebra), FMT_QTY));
            cells.push(cell(row, 5, { f: `=${ref(row, 4)}*${ref(row, 3)}`, v: money(tr.cost) }, Object.assign({}, st.numRow, zebra), FMT_MONEY));
            cells.push(cell(row, 6, { f: `=IF(${dur}>0,ROUNDUP(${ref(row, 4)}/${dur},0),0)`, v: tr.avg }, Object.assign({}, st.numRow, zebra), { fa: '0', t: 'n' }));
            cells.push(cell(row, 7, { f: `=IF(${dur}>0,MAX(${ref(row, 6)},ROUND(${ref(row, 4)}/${dur}*${peakRef},0)),0)`, v: tr.peak }, Object.assign({}, st.numRow, zebra), { fa: '0', t: 'n' }));
            cells.push(cell(row, 9, t.source, Object.assign({}, st.noteRow, zebra)));
        });
        const lt = R.labTotal;
        cells.push(cell(lt, 1, 'Total labour', st.subLabel));
        cells.push(cell(lt, 2, '', st.sub));
        cells.push(cell(lt, 3, '', st.sub));
        cells.push(cell(lt, 4, { f: `=SUM(${ref(R.labFirst, 4)}:${ref(lt - 1, 4)})`, v: money(res.labour.days) }, st.sub, FMT_QTY));
        cells.push(cell(lt, 5, { f: `=SUM(${ref(R.labFirst, 5)}:${ref(lt - 1, 5)})`, v: money(res.labour.cost) }, st.sub, FMT_MONEY));
        cells.push(cell(lt, 6, { f: `=SUM(${ref(R.labFirst, 6)}:${ref(lt - 1, 6)})`, v: res.labour.avg }, st.sub, { fa: '0', t: 'n' }));
        cells.push(cell(lt, 7, { f: `=SUM(${ref(R.labFirst, 7)}:${ref(lt - 1, 7)})`, v: res.labour.peak }, st.sub, { fa: '0', t: 'n' }));
        cells.push(cell(lt, 9, 'Workers are rounded up per trade', st.sub));

        // Bill of quantities
        cells.push(cell(R.bomSection, 0, 'BILL OF QUANTITIES', st.section));
        ['No.', 'Item', 'Unit', 'Quantity', 'Material rate (₹)', 'Labour rate (₹/unit)',
            'Material amount (₹)', 'Labour amount (₹)', 'Total (₹)', 'Note'].forEach((h, c) => cells.push(cell(R.head, c, h, st.header)));

        let itemNo = 1;
        const subtotalRows = [];
        groups.forEach((g) => {
            cells.push(cell(g.headRow, 0, String.fromCharCode(65 + g.gi), st.group));
            cells.push(cell(g.headRow, 1, g.gname.toUpperCase(), st.group));
            for (let c = 2; c < 10; c++) cells.push(cell(g.headRow, c, '', st.group));
            g.lines.forEach((l, idx) => {
                const row = itemRow.get(l);
                const bg = idx % 2 === 0 ? pal.bg : pal.alt;
                const num = Object.assign({}, st.numRow, { bg });
                const txt = Object.assign({}, st.txtRow, { bg });
                cells.push(cell(row, 0, itemNo++, Object.assign({}, num, { ht: 1 }), { fa: '0', t: 'n' }));
                cells.push(cell(row, 1, l.item, txt));
                cells.push(cell(row, 2, l.unit, Object.assign({}, txt, { ht: 1 })));
                if (l.qtyFromDuration) {
                    cells.push(cell(row, 3, l.qty > 0 ? { f: `=${dur}`, v: money(l.qty) } : 0, num, FMT_QTY));
                } else {
                    cells.push(cell(row, 3, money(l.qty), num, FMT_QTY));
                }
                const matFormula = l.matBase > 0 ? `=${round2(l.matBase)}*${A(R.zone, 3)}` : '=0';
                cells.push(cell(row, 4, { f: matFormula, v: money(l.mat) }, num, FMT_MONEY));
                const labFormula = l.norms.length
                    ? '=' + l.norms.map(([id, d]) => `${d}*${wageCell(id)}`).join('+')
                    : '=0';
                cells.push(cell(row, 5, { f: labFormula, v: money(l.lab) }, num, FMT_MONEY));
                cells.push(cell(row, 6, { f: `=${ref(row, 3)}*${ref(row, 4)}`, v: money(l.matAmt) }, num, FMT_MONEY));
                cells.push(cell(row, 7, { f: `=${ref(row, 3)}*${ref(row, 5)}`, v: money(l.labAmt) }, num, FMT_MONEY));
                cells.push(cell(row, 8, { f: `=${ref(row, 6)}+${ref(row, 7)}`, v: money(l.matAmt + l.labAmt) }, num, FMT_MONEY));
                cells.push(cell(row, 9, l.note, st.noteRow));
            });
            const sumMat = g.lines.reduce((t, l) => t + l.matAmt, 0);
            const sumLab = g.lines.reduce((t, l) => t + l.labAmt, 0);
            cells.push(cell(g.subRow, 1, `Subtotal, ${g.gname}`, st.subLabel));
            for (let c = 2; c < 6; c++) cells.push(cell(g.subRow, c, '', st.sub));
            cells.push(cell(g.subRow, 6, { f: `=SUM(${ref(g.first, 6)}:${ref(g.last, 6)})`, v: money(sumMat) }, st.sub, FMT_MONEY));
            cells.push(cell(g.subRow, 7, { f: `=SUM(${ref(g.first, 7)}:${ref(g.last, 7)})`, v: money(sumLab) }, st.sub, FMT_MONEY));
            cells.push(cell(g.subRow, 8, { f: `=${ref(g.subRow, 6)}+${ref(g.subRow, 7)}`, v: money(sumMat + sumLab) }, st.sub, FMT_MONEY));
            cells.push(cell(g.subRow, 9, '', st.sub));
            subtotalRows.push({ row: g.subRow, mat: sumMat, lab: sumLab });
        });

        // Totals (live formulas)
        r = tableEnd + 2;
        const sumRefs = (col) => subtotalRows.map((x) => ref(x.row, col)).join('+');
        const directMat = subtotalRows.reduce((t, x) => t + x.mat, 0);
        const directLab = subtotalRows.reduce((t, x) => t + x.lab, 0);
        const rowDirect = r;
        cells.push(cell(r, 1, 'DIRECT COST', st.directLabel));
        for (let c = 2; c < 6; c++) cells.push(cell(r, c, '', st.direct));
        cells.push(cell(r, 6, { f: `=${sumRefs(6)}`, v: money(directMat) }, st.direct, FMT_MONEY));
        cells.push(cell(r, 7, { f: `=${sumRefs(7)}`, v: money(directLab) }, st.direct, FMT_MONEY));
        cells.push(cell(r, 8, { f: `=${ref(r, 6)}+${ref(r, 7)}`, v: money(directMat + directLab) }, st.direct, FMT_MONEY));
        cells.push(cell(r, 9, '', st.direct));
        r++;

        const addTotal = (label, formula, value) => {
            cells.push(cell(r, 1, label, st.subLabel));
            for (let c = 2; c < 8; c++) cells.push(cell(r, c, '', st.sub));
            cells.push(cell(r, 8, { f: formula, v: money(value) }, st.sub, FMT_MONEY));
            cells.push(cell(r, 9, '', st.sub));
            return r++;
        };
        const rowCont = addTotal('Contingency', `=${ref(rowDirect, 8)}*${A(R.cont, 3)}`, res.totals.contingency);
        const rowOH = addTotal('Overhead and profit', `=(${ref(rowDirect, 8)}+${ref(rowCont, 8)})*${A(R.oh, 3)}`, res.totals.overhead);
        const rowGST = addTotal('GST', `=(${ref(rowDirect, 8)}+${ref(rowCont, 8)}+${ref(rowOH, 8)})*${A(R.gst, 3)}`, res.totals.gst);
        const rowGrand = r;
        cells.push(cell(r, 1, 'GRAND TOTAL (₹)', st.grandLabel));
        for (let c = 2; c < 8; c++) cells.push(cell(r, c, '', st.grand));
        cells.push(cell(r, 8, { f: `=${ref(rowDirect, 8)}+${ref(rowCont, 8)}+${ref(rowOH, 8)}+${ref(rowGST, 8)}`, v: money(res.totals.grand) }, st.grand, FMT_MONEY));
        cells.push(cell(r, 9, '', st.grand));
        r++;
        cells.push(cell(r, 1, 'Cost per m² of floor area (₹)', st.subLabel));
        for (let c = 2; c < 8; c++) cells.push(cell(r, c, '', st.sub));
        cells.push(cell(r, 8, { f: `=IF(${A(R.floor, 3)}>0,${ref(rowGrand, 8)}/${A(R.floor, 3)},0)`, v: money(res.totals.perM2) }, st.sub, FMT_MONEY));
        cells.push(cell(r, 9, '', st.sub));
        r += 2;
        cells.push(cell(r, 0, 'Not included: land, architect and approval fees, false ceilings beyond POP, modular kitchen, staircase, compound wall, external works, furniture, and site-specific structural design.', st.noteRow));
        merges[`${r}_0`] = { r, c: 0, rs: 1, cs: 10 };

        borders.push({ rangeType: 'range', borderType: 'border-all', style: '1', color: pal.border,
            range: [{ row: [R.labHead, lt], column: [1, 9] }, { row: [R.head, tableEnd], column: [0, 9] }] });

        return {
            name: 'Estimate', index: 0, order: 0, status: 1, showGridLines: 0,
            row: r + 5, column: 12, celldata: cells,
            config: {
                merge: merges,
                rowlen: { 0: 34, 1: 26, [R.labHead]: 34 },
                columnlen: { 0: 42, 1: 300, 2: 110, 3: 110, 4: 120, 5: 130, 6: 130, 7: 130, 8: 130, 9: 240 },
                borderInfo: borders
            }
        };
    }

    function wallsSheet(res, pal) {
        const cells = [];
        const hdr = ['No.', 'Wall or edge', 'Length (m)', 'Height (m)', 'Wall area, one face (m²)', 'Brickwork volume (m³)'];
        const st = { header: { bg: pal.accent, fc: pal.white, bl: 1, fs: 10, ht: 1, vt: 1 },
            row: { fc: pal.text, fs: 10, vt: 1 }, num: { fc: pal.text, fs: 10, ht: 2, vt: 1 },
            total: { bg: pal.soft, fc: pal.accent, bl: 1, fs: 10, vt: 1 }, totalNum: { bg: pal.soft, fc: pal.accent, bl: 1, fs: 10, ht: 2, vt: 1 } };
        cells.push(cell(0, 0, 'Walls and edges taken from the drawing', { bg: pal.accent, fc: pal.white, bl: 1, fs: 13, ht: 1, vt: 1 }));
        hdr.forEach((h, c) => cells.push(cell(2, c, h, st.header)));
        const H = res.settings.heightM, T = res.settings.brickThickM;
        res.geometry.walls.forEach((w, i) => {
            const r = 3 + i;
            cells.push(cell(r, 0, i + 1, st.num, { fa: '0', t: 'n' }));
            cells.push(cell(r, 1, w.label, st.row));
            cells.push(cell(r, 2, Math.round(w.lengthM * 1000) / 1000, st.num, FMT_QTY));
            cells.push(cell(r, 3, H, st.num, FMT_QTY));
            cells.push(cell(r, 4, { f: `=C${r + 1}*D${r + 1}`, v: Math.round(w.lengthM * H * 1000) / 1000 }, st.num, FMT_QTY));
            cells.push(cell(r, 5, { f: `=E${r + 1}*${T}`, v: Math.round(w.lengthM * H * T * 1000) / 1000 }, st.num, FMT_QTY));
        });
        const n = res.geometry.walls.length;
        const last = 3 + Math.max(n, 1) - 1;
        const tr = last + 2;
        const sumLen = res.geometry.wallLengthM;
        cells.push(cell(tr, 0, '', st.total));
        cells.push(cell(tr, 1, 'Total', st.total));
        cells.push(cell(tr, 2, { f: `=SUM(C4:C${last + 1})`, v: Math.round(sumLen * 1000) / 1000 }, st.totalNum, FMT_QTY));
        cells.push(cell(tr, 3, '', st.total));
        cells.push(cell(tr, 4, { f: `=SUM(E4:E${last + 1})`, v: Math.round(sumLen * H * 1000) / 1000 }, st.totalNum, FMT_QTY));
        cells.push(cell(tr, 5, { f: `=SUM(F4:F${last + 1})`, v: Math.round(sumLen * H * T * 1000) / 1000 }, st.totalNum, FMT_QTY));
        const borders = [{ rangeType: 'range', borderType: 'border-all', style: '1', color: pal.border,
            range: [{ row: [2, tr], column: [0, 5] }] }];
        return { name: 'Walls', index: 1, order: 1, status: 0, showGridLines: 0, row: tr + 6, column: 8, celldata: cells,
            config: { merge: { '0_0': { r: 0, c: 0, rs: 1, cs: 6 } }, rowlen: { 0: 30 },
                columnlen: { 0: 42, 1: 180, 2: 110, 3: 100, 4: 170, 5: 170 }, borderInfo: borders } };
    }

    function roomsSheet(res, pal) {
        const cells = [];
        const hdr = ['No.', 'Room', 'Floor area (m²)', 'Perimeter (m)', 'Wall height (m)', 'Wall area (m²)', 'Floor tiles (m²)'];
        const st = { header: { bg: pal.accent, fc: pal.white, bl: 1, fs: 10, ht: 1, vt: 1 },
            row: { fc: pal.text, fs: 10, vt: 1 }, num: { fc: pal.text, fs: 10, ht: 2, vt: 1 },
            total: { bg: pal.soft, fc: pal.accent, bl: 1, fs: 10, vt: 1 }, totalNum: { bg: pal.soft, fc: pal.accent, bl: 1, fs: 10, ht: 2, vt: 1 } };
        cells.push(cell(0, 0, 'Rooms closed by walls on the drawing', { bg: pal.accent, fc: pal.white, bl: 1, fs: 13, ht: 1, vt: 1 }));
        hdr.forEach((h, c) => cells.push(cell(2, c, h, st.header)));
        const H = res.settings.heightM;
        res.geometry.rooms.forEach((rm, i) => {
            const r = 3 + i;
            cells.push(cell(r, 0, i + 1, st.num, { fa: '0', t: 'n' }));
            cells.push(cell(r, 1, rm.name, st.row));
            cells.push(cell(r, 2, Math.round(rm.areaM2 * 1000) / 1000, st.num, FMT_QTY));
            cells.push(cell(r, 3, Math.round(rm.perimeterM * 1000) / 1000, st.num, FMT_QTY));
            cells.push(cell(r, 4, H, st.num, FMT_QTY));
            cells.push(cell(r, 5, { f: `=D${r + 1}*E${r + 1}`, v: Math.round(rm.perimeterM * H * 1000) / 1000 }, st.num, FMT_QTY));
            cells.push(cell(r, 6, { f: `=C${r + 1}*1.07`, v: Math.round(rm.areaM2 * 1.07 * 1000) / 1000 }, st.num, FMT_QTY));
        });
        const n = res.geometry.rooms.length;
        if (n) {
            const last = 3 + n - 1, tr = last + 2;
            cells.push(cell(tr, 0, '', st.total));
            cells.push(cell(tr, 1, 'Total', st.total));
            cells.push(cell(tr, 2, { f: `=SUM(C4:C${last + 1})`, v: Math.round(res.geometry.floorAreaM2 * 1000) / 1000 }, st.totalNum, FMT_QTY));
            cells.push(cell(tr, 3, { f: `=SUM(D4:D${last + 1})`, v: Math.round(res.geometry.perimeterM * 1000) / 1000 }, st.totalNum, FMT_QTY));
            cells.push(cell(tr, 4, '', st.total));
            cells.push(cell(tr, 5, { f: `=SUM(F4:F${last + 1})`, v: Math.round(res.geometry.perimeterM * H * 1000) / 1000 }, st.totalNum, FMT_QTY));
            cells.push(cell(tr, 6, { f: `=SUM(G4:G${last + 1})`, v: Math.round(res.geometry.floorAreaM2 * 1.07 * 1000) / 1000 }, st.totalNum, FMT_QTY));
        } else {
            cells.push(cell(3, 1, 'No closed rooms yet. Draw closed walls to create rooms.', st.row));
        }
        const borders = [{ rangeType: 'range', borderType: 'border-all', style: '1', color: pal.border,
            range: [{ row: [2, Math.max(3, n + 4)], column: [0, 6] }] }];
        return { name: 'Rooms', index: 2, order: 2, status: 0, showGridLines: 0, row: 40, column: 10, celldata: cells,
            config: { merge: { '0_0': { r: 0, c: 0, rs: 1, cs: 7 } }, rowlen: { 0: 30 },
                columnlen: { 0: 42, 1: 160, 2: 120, 3: 120, 4: 120, 5: 120, 6: 130 }, borderInfo: borders } };
    }

    function buildWorkbook(res) {
        const pal = palette();
        return [estimateSheet(res, pal), wallsSheet(res, pal), roomsSheet(res, pal)];
    }

    // ---------------------------------------------------------------
    // Luckysheet loader and renderer
    // ---------------------------------------------------------------
    function loadCss(href) {
        return new Promise((res, rej) => {
            const l = document.createElement('link');
            l.rel = 'stylesheet'; l.href = href;
            l.onload = res; l.onerror = () => rej(new Error('stylesheet failed: ' + href));
            document.head.appendChild(l);
        });
    }
    function loadJs(src) {
        return new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = src; s.onload = res;
            s.onerror = () => rej(new Error('script failed: ' + src));
            document.head.appendChild(s);
        });
    }
    function loadLuckysheet() {
        if (state.lsReady) return state.lsReady;
        state.lsReady = Promise.all(LS_CSS.map((p) => loadCss(LS_BASE + p)))
            .then(() => LS_JS.reduce((p, f) => p.then(() => loadJs(LS_BASE + f)), Promise.resolve()))
            .then(() => { if (!window.luckysheet) throw new Error('Luckysheet did not register'); })
            .catch((e) => { state.lsReady = null; throw e; });
        return state.lsReady;
    }

    function renderSheet(res) {
        const data = buildWorkbook(res);
        if (state.sheetCreated && window.luckysheet.destroy) {
            try { window.luckysheet.destroy(); } catch (e) { /* rebuilding anyway */ }
        }
        window.luckysheet.create({ container: 'asaf-est-sheet', lang: 'en', showinfobar: false, data });
        state.sheetCreated = true;
    }

    // ---------------------------------------------------------------
    // Panel UI
    // ---------------------------------------------------------------
    let panelEl = null, modalEl = null;
    const $ = (id) => document.getElementById(id);
    const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

    // Every estimation setting, in the order shown in the Estimation Settings window.
    const SETTINGS_FIELDS = [
        { key: 'zone', label: 'City / rate zone', type: 'zone' },
        { key: 'heightM', label: 'Wall height (m)', step: 0.1 },
        { key: 'brickThickM', label: 'Brick wall thickness (m)', step: 0.01 },
        { key: 'slabThickM', label: 'Roof slab thickness (m)', step: 0.005 },
        { key: 'footingWidthM', label: 'Footing width (m)', step: 0.05 },
        { key: 'footingThickM', label: 'Footing thickness (m)', step: 0.05 },
        { key: 'excavationDepthM', label: 'Excavation depth (m)', step: 0.05 },
        { key: 'colBeamM3PerRoom', label: 'Columns and beams concrete per room (m³)', step: 0.05 },
        { key: 'pointsPerRoom', label: 'Electrical points per room', step: 1 },
        { key: 'bathrooms', label: 'Bathrooms (blank = automatic)', step: 1, nullable: true },
        { key: 'kitchens', label: 'Kitchens', step: 1 },
        { key: 'doors', label: 'Doors (blank = one per room)', step: 1, nullable: true },
        { key: 'windows', label: 'Windows (blank = one per room)', step: 1, nullable: true },
        { key: 'workingDays', label: 'Site duration (working days)', step: 1 },
        { key: 'peakFactor', label: 'Peak labour factor', step: 0.05 },
        { key: 'contingencyPct', label: 'Contingency (%)', step: 0.5 },
        { key: 'overheadPct', label: 'Overhead and profit (%)', step: 0.5 },
        { key: 'gstPct', label: 'GST (%)', step: 0.5 }
    ];

    function ensureStylesheet() {
        if (document.querySelector('link[data-asaf-est-css]')) return;
        const l = document.createElement('link');
        l.rel = 'stylesheet'; l.href = CSS_HREF; l.setAttribute('data-asaf-est-css', '1');
        document.head.appendChild(l);
    }

    function fieldHtml(f, value) {
        const id = 'asaf-set-' + f.key;
        let input;
        if (f.type === 'zone') {
            input = `<select id="${id}">${Object.keys(ZONES).map((z) =>
                `<option value="${z}"${z === value ? ' selected' : ''}>${z} (×${ZONES[z].toFixed(2)})</option>`).join('')}</select>`;
        } else {
            input = `<input id="${id}" type="number" step="${f.step}" min="0" value="${value === null || value === undefined ? '' : value}"${f.nullable ? ' placeholder="auto"' : ''}>`;
        }
        return `<label class="asaf-est-field"><span>${f.label}</span>${input}</label>`;
    }

    function buildSettingsModal() {
        if (modalEl) return;
        ensureStylesheet();
        modalEl = document.createElement('div');
        modalEl.id = 'asaf-est-settings-modal';
        modalEl.className = 'asaf-est-modal';
        modalEl.innerHTML = `
            <div class="asaf-est-modal-card" role="dialog" aria-modal="true" aria-labelledby="asaf-est-modal-title">
                <div class="asaf-est-modal-head">
                    <h3 id="asaf-est-modal-title">Estimation Settings</h3>
                    <button type="button" class="asaf-est-iconbtn" id="asaf-est-modal-x" title="Close">×</button>
                </div>
                <p class="asaf-est-modal-note">Change any value, then press Apply. The estimate and sheet update straight away. Rates are indicative 2025–26 figures.</p>
                <div class="asaf-est-modal-grid" id="asaf-est-modal-fields"></div>
                <div class="asaf-est-modal-actions">
                    <button type="button" class="asaf-est-btn asaf-est-btn--ghost" id="asaf-est-modal-reset">Reset to defaults</button>
                    <button type="button" class="asaf-est-btn asaf-est-btn--ghost" id="asaf-est-modal-cancel">Cancel</button>
                    <button type="button" class="asaf-est-btn" id="asaf-est-modal-apply">Apply</button>
                </div>
            </div>`;
        document.body.appendChild(modalEl);
        $('asaf-est-modal-x').addEventListener('click', closeSettings);
        $('asaf-est-modal-cancel').addEventListener('click', closeSettings);
        $('asaf-est-modal-apply').addEventListener('click', applySettings);
        $('asaf-est-modal-reset').addEventListener('click', () => {
            state.settings = Object.assign({}, DEFAULTS);
            fillSettingsForm();
            applySettings();
        });
        modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeSettings(); });
    }

    function fillSettingsForm() {
        $('asaf-est-modal-fields').innerHTML = SETTINGS_FIELDS.map((f) => fieldHtml(f, state.settings[f.key])).join('');
    }

    function openSettings() {
        if (!state.open) open(); // settings change the estimate, so show it
        buildSettingsModal();
        fillSettingsForm();
        modalEl.classList.add('visible');
        const first = $('asaf-set-zone');
        if (first) first.focus();
    }

    function closeSettings() {
        if (modalEl) modalEl.classList.remove('visible');
    }

    /** Reads every settings field. Blank optional fields become null (automatic). */
    function applySettings() {
        const S = state.settings;
        SETTINGS_FIELDS.forEach((f) => {
            const el = $('asaf-set-' + f.key);
            if (!el) return;
            if (f.type === 'zone') { S.zone = ZONES[el.value] !== undefined ? el.value : DEFAULTS.zone; return; }
            const raw = el.value;
            if (raw === '' && f.nullable) { S[f.key] = null; return; }
            const n = parseFloat(raw);
            S[f.key] = isFinite(n) && n >= 0 ? n : DEFAULTS[f.key];
        });
        if (S.workingDays <= 0) S.workingDays = DEFAULTS.workingDays;
        if (S.peakFactor <= 0) S.peakFactor = DEFAULTS.peakFactor;
        closeSettings();
        recalc();
    }

    function buildPanel() {
        if (panelEl) return;
        ensureStylesheet();
        panelEl = document.createElement('div');
        panelEl.id = 'asaf-est-panel';
        panelEl.innerHTML = `
            <div class="asaf-est-head">
                <div class="asaf-est-title">House estimate <small>India · INR</small></div>
                <span id="asaf-est-status" class="asaf-est-status"></span>
                <button type="button" id="asaf-est-open-settings" class="asaf-est-btn asaf-est-btn--ghost">Estimation Settings</button>
                <button type="button" id="asaf-est-close" class="asaf-est-iconbtn" title="Back to drawing">×</button>
            </div>
            <div class="asaf-est-cards">
                <div class="asaf-est-card asaf-est-card--primary"><span>Grand total</span><b id="asaf-est-total">—</b></div>
                <div class="asaf-est-card"><span>Per m²</span><b id="asaf-est-perm2">—</b></div>
                <div class="asaf-est-card"><span>Per sq ft</span><b id="asaf-est-persqft">—</b></div>
                <div class="asaf-est-card"><span>Floor area</span><b id="asaf-est-floor">—</b></div>
                <div class="asaf-est-card"><span>Wall length</span><b id="asaf-est-wall">—</b></div>
                <div class="asaf-est-card"><span>Rooms</span><b id="asaf-est-rooms">—</b></div>
                <div class="asaf-est-card"><span>Labour days</span><b id="asaf-est-ldays">—</b></div>
                <div class="asaf-est-card"><span>Workers (avg)</span><b id="asaf-est-wavg">—</b></div>
                <div class="asaf-est-card"><span>Workers (peak)</span><b id="asaf-est-wpeak">—</b></div>
                <div class="asaf-est-card"><span>Labour cost</span><b id="asaf-est-lcost">—</b></div>
            </div>
            <div id="asaf-est-sheet" class="asaf-est-sheet"></div>`;
        document.body.appendChild(panelEl);
        $('asaf-est-open-settings').addEventListener('click', openSettings);
        $('asaf-est-close').addEventListener('click', close);
    }

    function setStatus(msg, isError) {
        const el = $('asaf-est-status');
        if (!el) return;
        el.textContent = msg;
        el.classList.toggle('error', !!isError);
    }

    function recalc() {
        if (!state.open) return;
        if (!window.ArchitectSAFCore || !window.ArchitectSAFCore.getEntities) {
            setStatus('CAD bridge not available', true);
            return;
        }
        const res = estimate(window.ArchitectSAFCore.getEntities(), state.settings);
        state.lastResult = res;
        const t = res.totals;
        $('asaf-est-total').textContent = inr.format(Math.round(t.grand));
        $('asaf-est-perm2').textContent = inr.format(Math.round(t.perM2));
        $('asaf-est-persqft').textContent = inr.format(Math.round(t.perM2 / SQFT_PER_M2));
        $('asaf-est-floor').textContent = res.geometry.floorAreaM2.toFixed(2) + ' m²';
        $('asaf-est-wall').textContent = res.geometry.wallLengthM.toFixed(2) + ' m';
        $('asaf-est-rooms').textContent = res.geometry.rooms.length;
        $('asaf-est-ldays').textContent = Math.round(res.labour.days).toLocaleString('en-IN');
        $('asaf-est-wavg').textContent = res.labour.avg;
        $('asaf-est-wpeak').textContent = res.labour.peak;
        $('asaf-est-lcost').textContent = inr.format(Math.round(res.labour.cost));

        const ignored = Object.keys(res.geometry.skipped || {});
        const note = ignored.length ? ' · not priced: ' + ignored.map((k) => res.geometry.skipped[k] + ' ' + k).join(', ') : '';
        setStatus(`${state.settings.zone} · ${res.geometry.walls.length} wall items · ${res.geometry.rooms.length} rooms · ${res.lines.length} bill lines${note}`);

        loadLuckysheet()
            .then(() => renderSheet(res))
            .catch((e) => setStatus('Spreadsheet unavailable (' + e.message + '). Check the internet connection.', true));
    }

    /** The estimation view fills the drawing area. The drawing is hidden while it is open. */
    function open() {
        state.open = true;
        buildPanel();
        document.body.classList.add('asaf-est-visible');
        recalc();
    }

    function close() {
        state.open = false;
        closeSettings();
        document.body.classList.remove('asaf-est-visible', 'asaf-est-full');
    }

    function setFull(on) { if (on) open(); else close(); }

    NS.open = open;
    NS.close = close;
    NS.recalculate = recalc;
    NS.toggle = () => (state.open ? close() : open());
    NS.setFull = setFull;
    NS.openSettings = openSettings;
    NS.closeSettings = closeSettings;
    NS.estimate = estimate;
    NS._test = { TRADES, segmentsFrom, splitAtJunctions, detectRooms, measureDrawing, quantities, billOfQuantities,
        estimate, mortar, COEF, RATES, ZONES, DEFAULTS, buildWorkbook, state };

    // Layout tabs: "Estimation" opens the full-width view, any other tab returns to the drawing.
    document.addEventListener('click', (e) => {
        const tab = e.target.closest ? e.target.closest('.layout-tab') : null;
        if (!tab) return;
        setFull(tab.dataset.layout === 'estimation');
    });

    // Refresh the estimate after every save while it is open.
    window.addEventListener('architectsaf:save', () => { if (state.open) recalc(); });
})();
