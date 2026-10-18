/**
 * Professional AutoCAD Web Engine - Selection & Multi-Delete Engine
 */

// Core Three.js Engine Variables
let scene, camera, renderer, raycaster, mouse;
let gridHelper, plane;

// AutoCAD System Variables (UNITS, LIMITS, PRECISION)
let sysUnits = 'mm';           // 'mm', 'cm', 'm', 'in', 'ft'
let sysPrecision = 2;          // Decimal places (e.g., 2 = 0.00)
let sysLimits = { minX: -500, minY: -500, maxX: 500, maxY: 500, active: true };

// State Engine & Tool Variables
let currentTool = 'select'; 
let toolStep = 0;              
let isDrawing = false;
let basePoint = null;
let currentPoints = [];
let activeBufferObj = null;

// Drawing & Selection Memory
let drawnObjects = [];         // Holds all active scene entities
let selectedObjects = [];      // Currently selected items
let hoverObject = null;        // Currently hovered item

// UI Dynamic Input Elements
let dynamicInputHUD, dynamicInputBox;

// ==========================================
// 1. INITIALIZATION & ENGINE SETUP
// ==========================================
function initCADViewer() {
    const container = document.getElementById('cad-canvas-container');
    if (!container) return;
    container.innerHTML = '';

    // 1.1 Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x181818);

    // 1.2 Camera (Orthographic 2D Drafting Setup)
    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = 200;
    camera = new THREE.OrthographicCamera(
        (frustumSize * aspect) / -2, (frustumSize * aspect) / 2,
        frustumSize / 2, frustumSize / -2,
        1, 2000
    );
    camera.position.set(0, 0, 500);
    camera.lookAt(0, 0, 0);

    // 1.3 WebGL Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    // 1.4 Raycaster & Interaction Plane
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    const planeGeo = new THREE.PlaneGeometry(10000, 10000);
    const planeMat = new THREE.MeshBasicMaterial({ visible: false });
    plane = new THREE.Mesh(planeGeo, planeMat);
    scene.add(plane);

    // 1.5 Grid
    gridHelper = new THREE.GridHelper(1000, 100, 0x444444, 0x2a2a2a);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    // Setup Dynamic Overlay (Hidden by default)
    setupDynamicInputUI(container);

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    const domEl = renderer.domElement;
    domEl.addEventListener('mousemove', onMouseMove);
    domEl.addEventListener('click', onCanvasClick);
    domEl.addEventListener('wheel', onMouseWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    animate();
    setCommandPrompt('Command: Ready. Select objects or pick a tool.');
}

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

// ==========================================
// 2. DYNAMIC INPUT (Hidden Until Typing)
// ==========================================
function setupDynamicInputUI(container) {
    if (document.getElementById('cad-hud-container')) return;

    dynamicInputHUD = document.createElement('div');
    dynamicInputHUD.id = 'cad-hud-container';
    dynamicInputHUD.style.cssText = `
        position: absolute; display: none; z-index: 1000; pointer-events: none;
        font-family: 'Consolas', 'Courier New', monospace; font-size: 11px;
        background: rgba(30, 30, 30, 0.95); border: 1px solid #007acc;
        padding: 3px 6px; border-radius: 3px; color: #00ffcc;
        box-shadow: 0px 2px 6px rgba(0,0,0,0.5);
    `;

    dynamicInputBox = document.createElement('input');
    dynamicInputBox.type = 'text';
    dynamicInputBox.id = 'cad-hud-input';
    dynamicInputBox.style.cssText = `
        background: transparent; border: none; outline: none; color: #ffffff;
        font-family: inherit; font-size: 11px; width: 90px; pointer-events: auto;
    `;

    dynamicInputHUD.appendChild(dynamicInputBox);
    container.appendChild(dynamicInputHUD);

    dynamicInputBox.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            processDynamicInputValue(this.value);
            this.value = '';
            hideDynamicInput();
            e.preventDefault();
        } else if (e.key === 'Escape') {
            this.value = '';
            hideDynamicInput();
        }
    });
}

function showDynamicInput() {
    if (dynamicInputHUD) dynamicInputHUD.style.display = 'block';
}

function hideDynamicInput() {
    if (dynamicInputHUD) {
        dynamicInputHUD.style.display = 'none';
        if (dynamicInputBox) dynamicInputBox.value = '';
    }
}

function processDynamicInputValue(val) {
    if (!val) return;
    const pt = getCursorWorldCoordinates();

    if (val.includes('<') && basePoint) {
        const parts = val.replace('@', '').split('<');
        const dist = parseFloat(parts[0]);
        const angleDeg = parseFloat(parts[1]);
        if (!isNaN(dist) && !isNaN(angleDeg)) {
            const rad = (angleDeg * Math.PI) / 180;
            const newPt = new THREE.Vector3(
                basePoint.x + dist * Math.cos(rad),
                basePoint.y + dist * Math.sin(rad),
                0
            );
            handleToolClick(newPt);
            return;
        }
    }

    const num = parseFloat(val);
    if (!isNaN(num) && basePoint) {
        const dir = new THREE.Vector3().subVectors(pt, basePoint).normalize();
        const targetPt = basePoint.clone().add(dir.multiplyScalar(num));
        handleToolClick(targetPt);
    }
}

// ==========================================
// 3. UTILITIES & COORDINATE CONVERSION
// ==========================================
function getCursorWorldCoordinates() {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObject(plane);
    if (intersects.length > 0) {
        let pt = intersects[0].point;
        if (sysLimits.active) {
            pt.x = Math.max(sysLimits.minX, Math.min(sysLimits.maxX, pt.x));
            pt.y = Math.max(sysLimits.minY, Math.min(sysLimits.maxY, pt.y));
        }
        return pt;
    }
    return new THREE.Vector3(0, 0, 0);
}

function formatVal(val) {
    return val.toFixed(sysPrecision) + ' ' + sysUnits;
}

function setCommandPrompt(msg) {
    const el = document.getElementById('cad-command-text');
    if (el) el.innerText = msg;
}

// ==========================================
// 4. MULTI-SELECTION & MOUSE INTERACTION
// ==========================================
function onMouseMove(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const pt = getCursorWorldCoordinates();

    const coordEl = document.getElementById('cad-coords');
    if (coordEl) coordEl.innerText = `X: ${formatVal(pt.x)} | Y: ${formatVal(pt.y)}`;

    if (dynamicInputHUD) {
        dynamicInputHUD.style.left = `${event.clientX - rect.left + 18}px`;
        dynamicInputHUD.style.top = `${event.clientY - rect.top + 18}px`;
    }

    // Hover effect
    if (currentTool === 'select' || currentTool === 'erase') {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(drawnObjects, true);
        if (intersects.length > 0) {
            if (hoverObject !== intersects[0].object) {
                clearHover();
                hoverObject = intersects[0].object;
                if (!selectedObjects.includes(hoverObject)) {
                    hoverObject.material.color.setHex(0x00ffff); // Cyan hover glow
                }
            }
        } else {
            clearHover();
        }
    }

    if (isDrawing && basePoint) {
        updateActiveBufferPreview(pt);
    }
}

function clearHover() {
    if (hoverObject && !selectedObjects.includes(hoverObject)) {
        hoverObject.material.color.setHex(hoverObject.userData.originalColor || 0xffffff);
        hoverObject = null;
    }
}

function clearSelection() {
    selectedObjects.forEach(obj => {
        obj.material.color.setHex(obj.userData.originalColor || 0xffffff);
    });
    selectedObjects = [];
}

function onCanvasClick(event) {
    const pt = getCursorWorldCoordinates();

    // Multi-Selection Logic in Select Mode
    if (currentTool === 'select') {
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObjects(drawnObjects, true);

        if (intersects.length > 0) {
            const clickedObj = intersects[0].object;

            if (event.shiftKey) {
                // Shift + Click to toggle individual items
                if (selectedObjects.includes(clickedObj)) {
                    selectedObjects = selectedObjects.filter(o => o !== clickedObj);
                    clickedObj.material.color.setHex(clickedObj.userData.originalColor || 0xffffff);
                } else {
                    selectedObjects.push(clickedObj);
                    clickedObj.material.color.setHex(0x00ffff);
                }
            } else {
                // Regular Click selects multiple or replaces selection
                if (!selectedObjects.includes(clickedObj)) {
                    clearSelection();
                    selectedObjects.push(clickedObj);
                    clickedObj.material.color.setHex(0x00ffff);
                }
            }
            setCommandPrompt(`Selected ${selectedObjects.length} object(s). Press DELETE to erase.`);
            return;
        } else if (!event.shiftKey) {
            clearSelection();
            setCommandPrompt('Command: Ready. Select objects or pick a tool.');
        }
    }

    handleToolClick(pt);
}

// ==========================================
// 5. BULK ERASE / DELETE OPERATIONS
// ==========================================
function deleteSelectedObjects() {
    if (selectedObjects.length === 0) {
        setCommandPrompt('No objects selected to delete.');
        return;
    }

    const count = selectedObjects.length;
    selectedObjects.forEach(obj => {
        scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        drawnObjects = drawnObjects.filter(o => o !== obj);
    });

    selectedObjects = [];
    hoverObject = null;
    setCommandPrompt(`Erased ${count} object(s).`);
}

// ==========================================
// 6. TOOL STATE MACHINE & COMMAND EXECUTION
// ==========================================
function setTool(toolName) {
    currentTool = toolName;
    toolStep = 0;
    isDrawing = false;
    basePoint = null;
    currentPoints = [];
    clearActiveBuffer();
    clearHover();
    hideDynamicInput();

    document.querySelectorAll('.cad-tool-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`tool-${toolName}`);
    if (activeBtn) activeBtn.classList.add('active');

    if (toolName === 'erase') {
        deleteSelectedObjects();
        setTool('select');
        return;
    }

    switch (toolName) {
        case 'line': setCommandPrompt('Command: LINE — Pick start point:'); break;
        case 'polyline': setCommandPrompt('Command: PLINE — Pick start point:'); break;
        case 'circle': setCommandPrompt('Command: CIRCLE — Pick center point:'); break;
        case 'arc': setCommandPrompt('Command: ARC — Pick start point:'); break;
        case 'text': setCommandPrompt('Command: TEXT — Pick insertion point:'); break;
        default: setCommandPrompt('Command: SELECT — Pick objects (Hold SHIFT for multi-selection).');
    }
}

function handleToolClick(pt) {
    if (currentTool === 'text') {
        const inputStr = prompt("Enter CAD Text Value:", "SafarEdge CAD");
        if (inputStr) createTextEntity(pt, inputStr);
        finishTool();
        return;
    }

    if (!isDrawing) {
        basePoint = pt.clone();
        currentPoints = [basePoint];
        isDrawing = true;
        toolStep = 1;
    } else {
        if (currentTool === 'line') {
            commitLine(basePoint, pt);
            basePoint = pt.clone();
        } else if (currentTool === 'polyline') {
            currentPoints.push(pt.clone());
            setCommandPrompt('PLINE — Next point (Press ENTER to finish, "C" to close):');
        } else if (currentTool === 'circle') {
            commitCircle(basePoint, basePoint.distanceTo(pt));
            finishTool();
        }
    }
}

function finishTool() {
    isDrawing = false;
    basePoint = null;
    currentPoints = [];
    toolStep = 0;
    clearActiveBuffer();
    hideDynamicInput();
    setTool('select');
}

// ==========================================
// 7. DRAWING ENTITIES & PREVIEW
// ==========================================
function commitLine(p1, p2) {
    const geom = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
    const line = new THREE.Line(geom, mat);
    line.userData = { type: 'line', originalColor: 0xffffff };
    scene.add(line);
    drawnObjects.push(line);
}

function commitPolyline(pts) {
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: 2 });
    const pline = new THREE.Line(geom, mat);
    pline.userData = { type: 'polyline', points: pts, originalColor: 0x00ff00 };
    scene.add(pline);
    drawnObjects.push(pline);
}

function commitCircle(center, radius) {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
        const theta = (i / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(center.x + Math.cos(theta) * radius, center.y + Math.sin(theta) * radius, 0));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: 0xffff00, linewidth: 2 });
    const circle = new THREE.Line(geom, mat);
    circle.userData = { type: 'circle', center: center, radius: radius, originalColor: 0xffff00 };
    scene.add(circle);
    drawnObjects.push(circle);
}

function createTextEntity(pt, textStr) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256; canvas.height = 64;
    ctx.fillStyle = '#00ffcc';
    ctx.font = 'bold 24px Consolas, monospace';
    ctx.fillText(textStr, 10, 42);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMat = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.position.set(pt.x, pt.y, 0);
    sprite.scale.set(20, 5, 1);
    scene.add(sprite);
    drawnObjects.push(sprite);
}

function updateActiveBufferPreview(pt) {
    clearActiveBuffer();
    const mat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 1.5 });

    if (currentTool === 'line') {
        const geom = new THREE.BufferGeometry().setFromPoints([basePoint, pt]);
        activeBufferObj = new THREE.Line(geom, mat);
        setCommandPrompt(`LINE — Dist: ${formatVal(basePoint.distanceTo(pt))}`);
    } else if (currentTool === 'polyline') {
        const pts = [...currentPoints, pt];
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        activeBufferObj = new THREE.Line(geom, mat);
    } else if (currentTool === 'circle') {
        const rad = basePoint.distanceTo(pt);
        const pts = [];
        for (let i = 0; i <= 64; i++) {
            const theta = (i / 64) * Math.PI * 2;
            pts.push(new THREE.Vector3(basePoint.x + Math.cos(theta) * rad, basePoint.y + Math.sin(theta) * rad, 0));
        }
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        activeBufferObj = new THREE.Line(geom, mat);
        setCommandPrompt(`CIRCLE — Radius: ${formatVal(rad)}`);
    }

    if (activeBufferObj) scene.add(activeBufferObj);
}

function clearActiveBuffer() {
    if (activeBufferObj) {
        scene.remove(activeBufferObj);
        activeBufferObj.geometry.dispose();
        activeBufferObj = null;
    }
}

// ==========================================
// 8. KEYBOARD & INTERACTION LISTENERS
// ==========================================
function onKeyDown(event) {
    // Delete Key / Backspace Key — Erases all selected objects
    if (event.key === 'Delete' || event.key === 'Backspace') {
        if (document.activeElement !== dynamicInputBox) {
            deleteSelectedObjects();
            event.preventDefault();
        }
    }

    // ESC Key — Cancel and unselect
    if (event.key === 'Escape') {
        clearSelection();
        finishTool();
    }

    // Enter Key — Complete Polyline
    if (event.key === 'Enter' && currentTool === 'polyline' && currentPoints.length > 1) {
        commitPolyline(currentPoints);
        finishTool();
    }

    // 'C' Key — Close Polyline loop
    if ((event.key === 'c' || event.key === 'C') && currentTool === 'polyline' && currentPoints.length > 2) {
        currentPoints.push(currentPoints[0].clone());
        commitPolyline(currentPoints);
        finishTool();
    }

    // Dynamically show HUD and focus input ONLY when user starts typing dimensions
    if (isDrawing && (event.key >= '0' && event.key <= '9' || event.key === '.' || event.key === '@' || event.key === '<')) {
        if (dynamicInputBox && document.activeElement !== dynamicInputBox) {
            showDynamicInput();
            dynamicInputBox.focus();
        }
    }
}

function onMouseWheel(event) {
    event.preventDefault();
    const zoomFactor = 1.1;
    if (event.deltaY < 0) camera.zoom *= zoomFactor;
    else camera.zoom /= zoomFactor;
    camera.zoom = Math.max(0.05, Math.min(camera.zoom, 100));
    camera.updateProjectionMatrix();
}

function onWindowResize() {
    const container = document.getElementById('cad-canvas-container');
    if (!container || !renderer) return;
    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = 200;
    camera.left = (-frustumSize * aspect) / 2;
    camera.right = (frustumSize * aspect) / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function resetZoom() {
    camera.position.set(0, 0, 500);
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    setCommandPrompt('Zoom Extents.');
}

function toggleGrid() {
    if (gridHelper) {
        gridHelper.visible = !gridHelper.visible;
        setCommandPrompt(`Grid ${gridHelper.visible ? 'ON' : 'OFF'}.`);
    }
}

// Global Export Bindings
window.initCADViewer = initCADViewer;
window.setTool = setTool;
window.toggleGrid = toggleGrid;
window.resetZoom = resetZoom;
window.deleteSelectedObjects = deleteSelectedObjects;