const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const imgInput = document.getElementById('imgInput');
const targetWInput = document.getElementById('targetW');
const targetHInput = document.getElementById('targetH');
const statusDiv = document.getElementById('status');

// Inputs
const portInput = document.getElementById('portInput');
const rotationInput = document.getElementById('rotationInput');
const toggleKeyInput = document.getElementById('toggleKeyInput');
const overlayKeyInput = document.getElementById('overlayKeyInput');
const overlayScaleInput = document.getElementById('overlayScaleInput');
const wheelRadiusInput = document.getElementById('wheelRadius');
const wheelTriggerTimeInput = document.getElementById('wheelTriggerTime');
const viewSensitivityInput = document.getElementById('viewSensitivity');
const viewAcceleration = document.getElementById('viewAcceleration');
const viewAutoReleaseInput = document.getElementById('viewAutoRelease');
const viewBindLMBInput = document.getElementById('viewBindLMB');
const sendIntervalInput = document.getElementById('sendInterval');
const pollingRateInput = document.getElementById('pollingRateInput');

const wheelModifierKey = document.getElementById('wheelModifierKey');
const wheelWalkRadius = document.getElementById('wheelWalkRadius');
const wheelStiffness = document.getElementById('wheelStiffness');
const wheelDamping = document.getElementById('wheelDamping');

// Scroll Config
const scrollUpMode = document.getElementById('scrollUpMode');
const btnSetScrollUp = document.getElementById('btnSetScrollUp');
const scrollDownMode = document.getElementById('scrollDownMode');
const btnSetScrollDown = document.getElementById('btnSetScrollDown');
const scrollDuration = document.getElementById('scrollDuration');

// Macro Config
const macroListDiv = document.getElementById('macroList');
const btnAddMacro = document.getElementById('btnAddMacro');
const macroEditor = document.getElementById('macroEditor');
const macroNameInput = document.getElementById('macroName');
const macroTriggerKeyInput = document.getElementById('macroTriggerKey');
const btnGetMacroKey = document.getElementById('btnGetMacroKey');
const macroModeSelect = document.getElementById('macroMode');
const macroActionListDiv = document.getElementById('macroActionList');
const newActionTypeSelect = document.getElementById('newActionType');
const btnAddAction = document.getElementById('btnAddAction');
const btnSaveMacro = document.getElementById('btnSaveMacro');
const btnDeleteMacro = document.getElementById('btnDeleteMacro');

// Activation
const licenseInput = document.getElementById('licenseInput');
const connStatus = document.getElementById('connStatus');
const macAddr = document.getElementById('macAddr');
const authStatus = document.getElementById('authStatus');

// Buttons
const btnAddWheel = document.getElementById('btnAddWheel');
const btnAddMouseWheel = document.getElementById('btnAddMouseWheel');
const btnAddView = document.getElementById('btnAddView');
const btnAddLMB = document.getElementById('btnAddLMB');
const btnAddRMB = document.getElementById('btnAddRMB');
const btnAddSide1 = document.getElementById('btnAddSide1');
const btnAddSide2 = document.getElementById('btnAddSide2');
const btnAddCustom = document.getElementById('btnAddCustom');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');

// Config Management
const configListDiv = document.getElementById('configList');
const currentConfigNameSpan = document.getElementById('currentConfigName');
const newConfigNameInput = document.getElementById('newConfigName');
const btnCreateConfig = document.getElementById('btnCreateConfig');

// State
let bgImg = null;
const DEFAULT_KEY_RADIUS = 25;
const DEFAULT_VIEW_W = 300;
const DEFAULT_VIEW_H = 200;
const HANDLE_SIZE = 10;
const DELETE_BTN_SIZE = 20;

let keyMap = {}; // { keyName: {x, y, radius} }
let wheelCenter = null; // {x, y, radius}
let mouseWheels = []; // Array of { key, x, y, radius }
let viewCenter = null; // {x, y, width, height}
let scrollUpConfig = { mode: 'none' };
let scrollDownConfig = { mode: 'none' };
let macros = []; // Array of MacroConfig
let currentMacroIndex = -1;

let selected = null; // { type: 'key'|'wheel'|'view'|'mouseWheel', id: string|null|index }
let interaction = null; // { type: 'drag'|'resize', startX, startY, origProps, handle? }
let pendingKeyName = null;
let pendingScrollSet = null; // { type: 'scrollUp'|'scrollDown', step: 0 }

// Unsaved changes tracking
let isDirty = false;
function markDirty() {
    if (isDirty) return;
    isDirty = true;
    saveBtn.style.background = '#e65100';
    saveBtn.style.boxShadow = '0 0 0 2px #ff9800';
    saveBtn.title = '有未保存的修改，请点击保存';
}
function clearDirty() {
    isDirty = false;
    saveBtn.style.background = '';
    saveBtn.style.boxShadow = '';
    saveBtn.title = '';
}
window.addEventListener('beforeunload', (e) => {
    if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// Status message with auto-clear
let statusClearTimer = null;
function setStatus(msg, color, autoClearMs) {
    statusDiv.innerText = msg;
    statusDiv.style.color = color || '';
    if (statusClearTimer) clearTimeout(statusClearTimer);
    if (autoClearMs) {
        statusClearTimer = setTimeout(() => {
            statusDiv.innerText = '';
            statusDiv.style.color = '';
        }, autoClearMs);
    }
}

// Canvas hint bar
const canvasHintEl = document.getElementById('canvasHint');
let canvasHintTimer = null;
function showCanvasHint(msg, persistent) {
    canvasHintEl.textContent = msg;
    canvasHintEl.classList.add('visible');
    if (canvasHintTimer) clearTimeout(canvasHintTimer);
    if (!persistent) {
        canvasHintTimer = setTimeout(() => canvasHintEl.classList.remove('visible'), 3000);
    }
}
function hideCanvasHint() {
    if (canvasHintTimer) clearTimeout(canvasHintTimer);
    canvasHintEl.classList.remove('visible');
}

// ESC to deselect / cancel pending
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (pendingKeyName || pendingScrollSet) {
            pendingKeyName = null;
            pendingScrollSet = null;
            canvas.classList.remove('pending');
            hideCanvasHint();
            setStatus('已取消', '#888', 1500);
            draw();
        } else if (selected) {
            selected = null;
            interaction = null;
            hidePropPanel();
            hideCanvasHint();
            draw();
        }
    }
}, { capture: false });

// Initialize
function init() {
    canvas.width = 1080;
    canvas.height = 2400;
    ctx.font = 'bold 48px Arial'; // Increased font size
    draw();
    
    // 加载配置文件列表
    loadConfigList();
}

// Config Management Logic
async function loadConfigList() {
    try {
        const res = await fetch('/config/list');
        const list = await res.json();
        
        configListDiv.innerHTML = '';
        list.forEach(cfg => {
            const item = document.createElement('div');
            item.className = 'config-item';
            item.style.display = 'flex';
            item.style.justifyContent = 'space-between';
            item.style.alignItems = 'center';
            item.style.padding = '5px';
            item.style.borderBottom = '1px solid #eee';
            
            if (cfg.isCurrent) {
                item.style.backgroundColor = '#e8f5e9';
                currentConfigNameSpan.textContent = cfg.filename;
            }
            
            const nameSpan = document.createElement('span');
            nameSpan.textContent = cfg.filename;
            nameSpan.style.cursor = 'pointer';
            nameSpan.style.flex = '1';
            nameSpan.onclick = () => switchConfig(cfg.filename);
            
            item.appendChild(nameSpan);
            
            // 删除按钮 (不能删除当前和默认)
            if (cfg.filename !== 'config.json' && !cfg.isCurrent) {
                const delBtn = document.createElement('button');
                delBtn.textContent = '×';
                delBtn.className = 'action-btn small danger';
                delBtn.style.padding = '0 5px';
                delBtn.onclick = (e) => {
                    e.stopPropagation();
                    if(confirm(`确认删除 ${cfg.filename}?`)) {
                        deleteConfig(cfg.filename);
                    }
                };
                item.appendChild(delBtn);
            }
            
            configListDiv.appendChild(item);
        });
    } catch (e) {
        console.error('Failed to load config list', e);
        setStatus('无法加载配置列表，请确认发送端程序正在运行', 'red');
    }
}

async function switchConfig(filename) {
    if (confirm(`确认切换到配置 ${filename}? 服务将自动重启。`)) {
        try {
            const res = await fetch('/config/switch', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({filename: filename})
            });
            const result = await res.json();
            if (result.ok) {
                setStatus(`已切换到 ${filename}，正在重启...`, 'green');
                setTimeout(() => location.reload(), 1500);
            } else {
                setStatus('切换配置失败', 'red');
            }
        } catch (e) {
            setStatus('切换失败：无法连接到发送端程序', 'red');
        }
    }
}

async function createConfig() {
    const name = newConfigNameInput.value.trim();
    if (!name) return;
    
    try {
        const res = await fetch('/config/create', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({filename: name})
        });
        const result = await res.json();
        if (result.ok) {
            newConfigNameInput.value = '';
            setStatus('创建成功', 'green', 2000);
            loadConfigList();
        } else {
            setStatus('创建失败，配置文件可能已存在', 'red');
        }
    } catch (e) {
        setStatus('创建失败：无法连接到发送端程序', 'red');
    }
}

async function deleteConfig(filename) {
    try {
        const res = await fetch('/config/delete', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({filename: filename})
        });
        const result = await res.json();
        if (result.ok) {
            setStatus('删除成功', 'green', 2000);
            loadConfigList();
        } else {
            setStatus('删除失败', 'red');
        }
    } catch (e) {
        setStatus('删除失败：无法连接到发送端程序', 'red');
    }
}

btnCreateConfig.addEventListener('click', createConfig);

// Toolbar Logic
const toolbar = document.getElementById('toolbar');
const toolbarHeader = document.getElementById('toolbarHeader');
const toolbarToggle = document.getElementById('toolbarToggle');

// Dragging
let isToolbarDragging = false;
let toolbarDragOffsetX = 0;
let toolbarDragOffsetY = 0;

toolbarHeader.addEventListener('mousedown', (e) => {
    if (e.target === toolbarToggle) return;
    isToolbarDragging = true;
    toolbarDragOffsetX = e.clientX - toolbar.offsetLeft;
    toolbarDragOffsetY = e.clientY - toolbar.offsetTop;
    toolbar.style.transition = 'none'; 
});

document.addEventListener('mousemove', (e) => {
    if (isToolbarDragging) {
        let newLeft = e.clientX - toolbarDragOffsetX;
        let newTop = e.clientY - toolbarDragOffsetY;
        
        // Simple boundaries
        const maxLeft = window.innerWidth - 50;
        const maxTop = window.innerHeight - 50;
        
        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft > maxLeft) newLeft = maxLeft;
        if (newTop > maxTop) newTop = maxTop;

        toolbar.style.left = newLeft + 'px';
        toolbar.style.top = newTop + 'px';
    }
});

document.addEventListener('mouseup', () => {
    if (isToolbarDragging) {
        isToolbarDragging = false;
        toolbar.style.transition = ''; 
    }
});

// Toggle Collapse
toolbarToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toolbar.classList.toggle('panel-collapsed');
    toolbarToggle.innerText = toolbar.classList.contains('panel-collapsed') ? '+' : '−';
});

// Sub Panel Logic
const subPanel = document.getElementById('subPanel');
const subPanelTitle = document.getElementById('subPanelTitle');
const subPanelContent = document.getElementById('subPanelContent');
let currentSource = null;

function openSubPanel(moduleId) {
    const titles = {
        'config_manage': '配置文件管理',
        'basic': '基础设置 & 截图',
        'components': '添加组件',
        'scroll': '鼠标滚轮配置',
        'macro': '宏系统配置',
        'advanced': '高级参数',
        'vpointer': 'vPointer 配置',
        'anticheat': '反作弊参数',
        'activation': '设备激活 & 状态'
    };
    
    // 1. Move current content back to source if any
    if (currentSource) {
        const sourceDiv = document.getElementById('source-' + currentSource);
        if (sourceDiv) {
            while (subPanelContent.firstChild) {
                sourceDiv.appendChild(subPanelContent.firstChild);
            }
        }
    }

    // 2. If clicking same module, just close it
    if (currentSource === moduleId && subPanel.style.display !== 'none') {
        closeSubPanel();
        return;
    }

    // 3. Move new content to subPanel
    const newSourceDiv = document.getElementById('source-' + moduleId);
    if (newSourceDiv) {
        while (newSourceDiv.firstChild) {
            subPanelContent.appendChild(newSourceDiv.firstChild);
        }
    }

    // 4. Update UI
    subPanelTitle.innerText = titles[moduleId] || '配置';
    subPanel.style.display = 'flex';
    currentSource = moduleId;

    // Position subPanel next to toolbar
    const rect = toolbar.getBoundingClientRect();
    subPanel.style.left = (rect.right + 10) + 'px';
    subPanel.style.top = rect.top + 'px';
}

function closeSubPanel() {
    if (currentSource) {
        const sourceDiv = document.getElementById('source-' + currentSource);
        if (sourceDiv) {
            while (subPanelContent.firstChild) {
                sourceDiv.appendChild(subPanelContent.firstChild);
            }
        }
    }
    subPanel.style.display = 'none';
    currentSource = null;
}

// Make SubPanel Draggable too
const subHeader = document.querySelector('.sub-header');
let isSubDragging = false;
let subDragOffsetX = 0;
let subDragOffsetY = 0;

subHeader.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('close-btn')) return;
    isSubDragging = true;
    subDragOffsetX = e.clientX - subPanel.offsetLeft;
    subDragOffsetY = e.clientY - subPanel.offsetTop;
});

document.addEventListener('mousemove', (e) => {
    if (isSubDragging) {
        let newLeft = e.clientX - subDragOffsetX;
        let newTop = e.clientY - subDragOffsetY;
        subPanel.style.left = newLeft + 'px';
        subPanel.style.top = newTop + 'px';
    }
});

document.addEventListener('mouseup', () => {
    isSubDragging = false;
});

/**
 * Draw everything
 */
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    if (bgImg) {
        ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#eee';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#999';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 60px Arial'; // Larger hint text
        ctx.fillText('请上传游戏截图以开始配置', canvas.width/2, canvas.height/2);
    }

    // Draw Wheel
    if (wheelCenter) {
        drawCircleComponent(wheelCenter.x, wheelCenter.y, wheelCenter.radius, 'WASD', 'rgba(255, 165, 0, 0.8)', 'rgba(255, 165, 0, 0.4)');
    }

    // Draw MouseWheels
    mouseWheels.forEach((mw, idx) => {
        drawCircleComponent(mw.x, mw.y, mw.radius, 'MW:' + mw.key, 'rgba(153, 50, 204, 0.8)', 'rgba(153, 50, 204, 0.4)');
    });

    // Draw View (Rect)
    if (viewCenter) {
        drawRectComponent(viewCenter.x, viewCenter.y, viewCenter.width, viewCenter.height, 'VIEW', 'rgba(0, 255, 127, 0.8)', 'rgba(0, 255, 127, 0.4)');
    }

    // Draw Scroll Actions
    const drawScroll = (cfg, label) => {
        if (cfg.mode === 'tap') {
            drawCircleComponent(cfg.x, cfg.y, 40, label + '(Tap)', 'rgba(255, 0, 0, 0.8)', 'rgba(255, 0, 0, 0.2)');
        } else if (cfg.mode === 'swipe') {
            // Draw Start
            drawCircleComponent(cfg.startX, cfg.startY, 30, label + ' S', 'rgba(0, 200, 255, 0.8)', 'rgba(0, 200, 255, 0.4)');
            // Draw End
            drawCircleComponent(cfg.endX, cfg.endY, 30, label + ' E', 'rgba(0, 200, 255, 0.8)', 'rgba(0, 200, 255, 0.4)');
            // Draw Arrow
            ctx.beginPath();
            ctx.moveTo(cfg.startX, cfg.startY);
            ctx.lineTo(cfg.endX, cfg.endY);
            ctx.strokeStyle = 'rgba(0, 200, 255, 0.8)';
            ctx.lineWidth = 8;
            ctx.stroke();
            // Arrow head
            const angle = Math.atan2(cfg.endY - cfg.startY, cfg.endX - cfg.startX);
            const headLen = 25;
            ctx.beginPath();
            ctx.moveTo(cfg.endX, cfg.endY);
            ctx.lineTo(cfg.endX - headLen * Math.cos(angle - Math.PI / 6), cfg.endY - headLen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(cfg.endX - headLen * Math.cos(angle + Math.PI / 6), cfg.endY - headLen * Math.sin(angle + Math.PI / 6));
            ctx.fillStyle = 'rgba(0, 200, 255, 0.8)';
            ctx.fill();
        }
    };
    if (scrollUpConfig.mode !== 'none') drawScroll(scrollUpConfig, 'UP');
    if (scrollDownConfig.mode !== 'none') drawScroll(scrollDownConfig, 'DOWN');

    // Draw Keys
    Object.entries(keyMap).forEach(([key, pos]) => {
        let color = '#007bff';
        if (['LMB', 'RMB', 'X1', 'X2'].includes(key)) color = '#e91e63';
        const fillColor = hexToRgba(color, 0.4);
        drawCircleComponent(pos.x, pos.y, pos.radius, key, color, fillColor);
    });

    // Draw Selection (Handles & Delete)
    if (selected) {
        drawSelectionOverlay();
    }
}

function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawCircleComponent(x, y, r, label, strokeColor, fillColor) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 5; // Thicker lines
    ctx.stroke();

    // Label
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Dynamic font size based on radius, but minimum 24px
    ctx.font = 'bold ' + Math.max(24, r/1.5) + 'px Arial';
    ctx.fillText(label, x, y);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeText(label, x, y);
}

function drawRectComponent(x, y, w, h, label, strokeColor, fillColor) {
    const left = x - w/2;
    const top = y - h/2;
    ctx.fillStyle = fillColor;
    ctx.fillRect(left, top, w, h);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, w, h);

    // Label
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 24px Arial';
    ctx.fillText(label, x, y);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeText(label, x, y);
}

function drawSelectionOverlay() {
    let bounds = getBounds(selected);
    if (!bounds) return;

    // Draw Bounding Box (for visual clarity)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.setLineDash([]);

    // Draw Resize Handles (Corners)
    const handles = getHandles(selected);
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    handles.forEach(h => {
        ctx.beginPath();
        ctx.arc(h.x, h.y, HANDLE_SIZE/2, 0, Math.PI*2);
        ctx.fill();
        ctx.stroke();
    });

    // Draw Delete Button (Top-Right)
    const delX = bounds.x + bounds.w;
    const delY = bounds.y;
    ctx.beginPath();
    ctx.arc(delX, delY, DELETE_BTN_SIZE/2, 0, Math.PI*2);
    ctx.fillStyle = 'red';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // X icon
    ctx.beginPath();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.moveTo(delX - 4, delY - 4);
    ctx.lineTo(delX + 4, delY + 4);
    ctx.moveTo(delX + 4, delY - 4);
    ctx.lineTo(delX - 4, delY + 4);
    ctx.stroke();
}

function getBounds(sel) {
    if (sel.type === 'key') {
        const item = keyMap[sel.id];
        if (!item) return null;
        return { x: item.x - item.radius, y: item.y - item.radius, w: item.radius*2, h: item.radius*2 };
    } else if (sel.type === 'wheel') {
        if (!wheelCenter) return null;
        return { x: wheelCenter.x - wheelCenter.radius, y: wheelCenter.y - wheelCenter.radius, w: wheelCenter.radius*2, h: wheelCenter.radius*2 };
    } else if (sel.type === 'mouseWheel') {
        const mw = mouseWheels[sel.id];
        if (!mw) return null;
        return { x: mw.x - mw.radius, y: mw.y - mw.radius, w: mw.radius*2, h: mw.radius*2 };
    } else if (sel.type === 'view') {
        if (!viewCenter) return null;
        return { x: viewCenter.x - viewCenter.width/2, y: viewCenter.y - viewCenter.height/2, w: viewCenter.width, h: viewCenter.height };
    }
    return null;
}

function getHandles(sel) {
    const b = getBounds(sel);
    if (!b) return [];
    // 4 Corners
    return [
        { name: 'tl', x: b.x, y: b.y },
        { name: 'tr', x: b.x + b.w, y: b.y },
        { name: 'bl', x: b.x, y: b.y + b.h },
        { name: 'br', x: b.x + b.w, y: b.y + b.h }
    ];
}

// Helper: Check hit
function checkHit(x, y) {
    // 1. Check Delete Button of Selected
    if (selected) {
        const b = getBounds(selected);
        if (b) {
            const delX = b.x + b.w;
            const delY = b.y;
            if (Math.hypot(x - delX, y - delY) <= DELETE_BTN_SIZE) {
                return { type: 'delete' };
            }
        }
        // 2. Check Handles
        const handles = getHandles(selected);
        for (const h of handles) {
            if (Math.hypot(x - h.x, y - h.y) <= HANDLE_SIZE) {
                return { type: 'resize', handle: h.name };
            }
        }
    }

    // 3. Check Items (Keys, Wheel, View)
    // Reverse order to pick top-most
    // Keys
    for (const [key, pos] of Object.entries(keyMap)) {
        if (Math.hypot(x - pos.x, y - pos.y) <= pos.radius) {
            return { type: 'select', targetType: 'key', id: key };
        }
    }
    // Wheel
    if (wheelCenter) {
        if (Math.hypot(x - wheelCenter.x, y - wheelCenter.y) <= wheelCenter.radius) {
            return { type: 'select', targetType: 'wheel', id: 'wheel' };
        }
    }
    // MouseWheels
    for (let i = 0; i < mouseWheels.length; i++) {
        const mw = mouseWheels[i];
        if (Math.hypot(x - mw.x, y - mw.y) <= mw.radius) {
            return { type: 'select', targetType: 'mouseWheel', id: i };
        }
    }
    // View
    if (viewCenter) {
        const left = viewCenter.x - viewCenter.width/2;
        const top = viewCenter.y - viewCenter.height/2;
        if (x >= left && x <= left + viewCenter.width && y >= top && y <= top + viewCenter.height) {
            return { type: 'select', targetType: 'view', id: 'view' };
        }
    }

    return null;
}

// Interaction
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (pendingKeyName) {
        keyMap[pendingKeyName] = { x: Math.round(x), y: Math.round(y), radius: DEFAULT_KEY_RADIUS };
        pendingKeyName = null;
        canvas.classList.remove('pending');
        hideCanvasHint();
        setStatus('按键已添加', '#4caf50', 2000);
        markDirty();
        draw();
        return;
    }

    if (pendingScrollSet) {
        const cfg = pendingScrollSet.type === 'scrollUp' ? scrollUpConfig : scrollDownConfig;
        const mode = pendingScrollSet.type === 'scrollUp' ? scrollUpMode.value : scrollDownMode.value;
        cfg.mode = mode;

        if (mode === 'tap') {
            cfg.x = Math.round(x);
            cfg.y = Math.round(y);
            pendingScrollSet = null;
            canvas.classList.remove('pending');
            hideCanvasHint();
            setStatus('滚轮点击位置已设置', '#4caf50', 2000);
            markDirty();
        } else if (mode === 'swipe') {
            if (pendingScrollSet.step === 0) {
                cfg.startX = Math.round(x);
                cfg.startY = Math.round(y);
                pendingScrollSet.step = 1;
                showCanvasHint('请点击设置滑动终点 | ESC 取消', true);
                setStatus('已设置起始点，请点击设置结束点', 'blue');
            } else {
                cfg.endX = Math.round(x);
                cfg.endY = Math.round(y);
                pendingScrollSet = null;
                canvas.classList.remove('pending');
                hideCanvasHint();
                setStatus('滚轮滑动区域已设置', '#4caf50', 2000);
                markDirty();
            }
        }
        draw();
        return;
    }

    const hit = checkHit(x, y);
    
    if (hit) {
        if (hit.type === 'delete') {
            if (selected.type === 'key') delete keyMap[selected.id];
            else if (selected.type === 'wheel') wheelCenter = null;
            else if (selected.type === 'mouseWheel') mouseWheels.splice(selected.id, 1);
            else if (selected.type === 'view') viewCenter = null;
            selected = null;
            markDirty();
            hidePropPanel();
            draw();
            return;
        }
        if (hit.type === 'resize') {
            let props = {};
            if (selected.type === 'key') props = {...keyMap[selected.id]};
            else if (selected.type === 'wheel') props = {...wheelCenter};
            else if (selected.type === 'mouseWheel') props = {...mouseWheels[selected.id]};
            else if (selected.type === 'view') props = {...viewCenter};
            interaction = { type: 'resize', handle: hit.handle, startX: x, startY: y, origProps: props };
            return;
        }
        if (hit.type === 'select') {
            selected = { type: hit.targetType, id: hit.id };

            // Update inputs based on selection
            if (selected.type === 'wheel') {
                wheelRadiusInput.value = Math.round(wheelCenter.radius);
            } else if (selected.type === 'mouseWheel') {
                const mw = mouseWheels[selected.id];
                wheelRadiusInput.value = Math.round(mw.radius);
                wheelTriggerTimeInput.value = mw.triggerTime || 0;
            } else if (selected.type === 'key') {
                wheelRadiusInput.value = Math.round(keyMap[selected.id].radius);
            }

            let props = {};
            if (selected.type === 'key') props = {...keyMap[selected.id]};
            else if (selected.type === 'wheel') props = {...wheelCenter};
            else if (selected.type === 'mouseWheel') props = {...mouseWheels[selected.id]};
            else if (selected.type === 'view') props = {...viewCenter};
            interaction = { type: 'drag', startX: x, startY: y, origProps: props };
            showPropPanel(selected.type);
            showCanvasHint('拖动移动 | 滚轮调整大小 | 角点拖拽缩放 | ESC 取消选中');
            draw();
            return;
        }
    } else {
        selected = null;
        hidePropPanel();
        draw();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Cursor
    const hit = checkHit(x, y);
    if (interaction) {
        canvas.style.cursor = interaction.type === 'drag' ? 'grabbing' : 'nwse-resize';
    } else {
        if (hit) {
            if (hit.type === 'delete') canvas.style.cursor = 'pointer';
            else if (hit.type === 'resize') canvas.style.cursor = 'nwse-resize';
            else canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = 'default';
        }
    }

    if (!interaction) return;

    const dx = x - interaction.startX;
    const dy = y - interaction.startY;
    const orig = interaction.origProps;

    if (interaction.type === 'drag') {
        if (selected.type === 'key') {
            keyMap[selected.id].x = orig.x + dx;
            keyMap[selected.id].y = orig.y + dy;
        } else if (selected.type === 'wheel') {
            wheelCenter.x = orig.x + dx;
            wheelCenter.y = orig.y + dy;
        } else if (selected.type === 'mouseWheel') {
            mouseWheels[selected.id].x = orig.x + dx;
            mouseWheels[selected.id].y = orig.y + dy;
        } else if (selected.type === 'view') {
            viewCenter.x = orig.x + dx;
            viewCenter.y = orig.y + dy;
        }
    } else if (interaction.type === 'resize') {
        // Handle Resize
        // For Circle (Key/Wheel): Resize radius based on distance from center
        if (selected.type === 'key' || selected.type === 'wheel' || selected.type === 'mouseWheel') {
            // Simple logic: distance from center
            // Or bounding box logic.
            // Let's use bounding box logic (corner drag)
            // If dragging BR corner, radius = dist(center, mouse)
            // But dragging TL corner? 
            // Better: calculate new radius based on handle movement.
            // If handle is BR, radius change = (dx + dy)/2 roughly?
            // Let's just use distance from center to mouse position as new radius.
            // This is intuitive.
            
            let center = { x: orig.x, y: orig.y }; // Center doesn't move for circle resize usually?
            // But if I drag corner of bounding box, center might shift in some apps.
            // Here let's keep center fixed and just adjust radius.
            let newR = Math.hypot(x - center.x, y - center.y);
            if (newR < 10) newR = 10;
            
            if (selected.type === 'key') {
                keyMap[selected.id].radius = newR;
                wheelRadiusInput.value = Math.round(newR);
            } else if (selected.type === 'wheel') {
                wheelCenter.radius = newR;
                wheelRadiusInput.value = Math.round(newR);
            } else if (selected.type === 'mouseWheel') {
                mouseWheels[selected.id].radius = newR;
                wheelRadiusInput.value = Math.round(newR);
            }
            syncPropPanelRadius();
        } else if (selected.type === 'view') {
            // Rect Resize
            // This is trickier. Need to update x, y (center) and width, height.
            let newX = orig.x;
            let newY = orig.y;
            let newW = orig.width;
            let newH = orig.height;

            // Calculate new bounds based on handle
            // Original bounds
            let left = orig.x - orig.width/2;
            let top = orig.y - orig.height/2;
            let right = orig.x + orig.width/2;
            let bottom = orig.y + orig.height/2;

            if (interaction.handle.includes('l')) left += dx;
            if (interaction.handle.includes('r')) right += dx;
            if (interaction.handle.includes('t')) top += dy;
            if (interaction.handle.includes('b')) bottom += dy;

            // Normalize
            if (left > right) { let t = left; left = right; right = t; }
            if (top > bottom) { let t = top; top = bottom; bottom = t; }

            newW = right - left;
            newH = bottom - top;
            newX = left + newW/2;
            newY = top + newH/2;

            viewCenter.x = newX;
            viewCenter.y = newY;
            viewCenter.width = newW;
            viewCenter.height = newH;
        }
    }
    draw();
});

canvas.addEventListener('mouseup', () => { if (interaction) { markDirty(); } interaction = null; });
canvas.addEventListener('mouseleave', () => interaction = null);
// Keep Wheel Zoom logic (optional, but requested previously. Now drag is preferred, but wheel zoom is also nice)
// User said "只能滚轮调节...请做成可以自定义拉伸".
// I'll keep wheel zoom as an alternative shortcut.
// Sync radius value to property panel input after resize operations
function syncPropPanelRadius() {
    const el = document.getElementById('pp_wheelRadius');
    if (!el || !selected) return;
    el.value = wheelRadiusInput.value;
}

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!selected) return;

    const delta = e.deltaY > 0 ? -5 : 5;
    if (selected.type === 'key') {
        let r = keyMap[selected.id].radius;
        r += delta;
        if (r < 10) r = 10;
        keyMap[selected.id].radius = r;
        wheelRadiusInput.value = Math.round(r);
    } else if (selected.type === 'wheel') {
        let r = wheelCenter.radius;
        r += delta;
        if (r < 10) r = 10;
        wheelCenter.radius = r;
        wheelRadiusInput.value = Math.round(r);
    } else if (selected.type === 'mouseWheel') {
        let r = mouseWheels[selected.id].radius;
        r += delta;
        if (r < 10) r = 10;
        mouseWheels[selected.id].radius = r;
        wheelRadiusInput.value = Math.round(r);
    } else if (selected.type === 'view') {
        // Resize both w/h
        let w = viewCenter.width + delta*2;
        let h = viewCenter.height + delta*2;
        if (w < 20) w = 20;
        if (h < 20) h = 20;
        viewCenter.width = w;
        viewCenter.height = h;
    }
    syncPropPanelRadius();
    markDirty();
    draw();
}, { passive: false });

// Input Change Handlers
// Mark dirty on any input/select/checkbox change in the config panels
document.getElementById('configSources').addEventListener('input', markDirty);
document.getElementById('configSources').addEventListener('change', markDirty);

pollingRateInput.addEventListener('change', () => {
    const rate = parseInt(pollingRateInput.value || 0, 10);
    if (rate > 0) {
        // 如果设置了回报率，自动更新间隔显示（仅预览，保存时两个都会发）
        sendIntervalInput.value = Math.round(1000 / rate);
        sendIntervalInput.disabled = true;
        sendIntervalInput.title = "已启用回报率，间隔由回报率自动计算";
    } else {
        sendIntervalInput.disabled = false;
        sendIntervalInput.title = "";
    }
});

sendIntervalInput.addEventListener('change', () => {
    const interval = parseInt(sendIntervalInput.value || 0, 10);
    if (interval > 0 && pollingRateInput.value == 0) {
        // 只有在没有设置回报率时，才根据间隔反推一个回报率预览
        // pollingRateInput.value = Math.round(1000 / interval);
    }
});

wheelTriggerTimeInput.addEventListener('change', () => {
    if (selected && selected.type === 'mouseWheel') {
        let val = parseInt(wheelTriggerTimeInput.value || 0, 10);
        if (val < 0) val = 0;
        mouseWheels[selected.id].triggerTime = val;
    }
});

// Helper to listen for single key press or mouse button
function listenForKey(callback) {
    setStatus('请按下键盘按键或鼠标键... (点击空白处取消)', 'blue');
    
    // Handler for Keyboard
    const keyHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        let keyName = "";
        
        // Special mapping
        const codeMap = {
            "Space": "SPACE",
            "Enter": "ENTER",
            "Escape": "ESC",
            "Tab": "TAB",
            "Backspace": "BACKSPACE",
            "ShiftLeft": "SHIFT",
            "ShiftRight": "SHIFT",
            "ControlLeft": "CTRL",
            "ControlRight": "CTRL",
            "AltLeft": "ALT",
            "AltRight": "ALT",
            "Backquote": "TILDE",
            "Minus": "-",
            "Equal": "=",
            "BracketLeft": "[",
            "BracketRight": "]",
            "Backslash": "\\",
            "Semicolon": ";",
            "Quote": "'",
            "Comma": ",",
            "Period": ".",
            "Slash": "/",
        };

        if (codeMap[e.code]) {
            keyName = codeMap[e.code];
        } else if (e.key === "Process" || e.key === "Unidentified") {
            // IME 或未识别，尝试使用 code
            keyName = e.code.toUpperCase();
        } else if (e.key.length === 1) {
            // alphanumeric
            keyName = e.key.toUpperCase();
        } else if (e.code.startsWith("F") && e.code.length <= 3) {
            // F1-F12
            keyName = e.code;
        } else {
            // Fallback
            keyName = e.key.toUpperCase();
        }

        cleanup();
        setStatus(`已识别按键: ${keyName}`, '#4caf50', 2000);

        if (callback) callback(keyName, e.keyCode); // Pass keyCode as VK approximation
    };

    // Handler for Mouse Buttons (Middle/Side)
    const mouseHandler = (e) => {
        // e.button: 0=Left, 1=Middle, 2=Right, 3=X1, 4=X2
        // We generally don't want to bind Left Click (0) as it is used for interaction
        // But if we want to allow binding anything...
        // MMB is 1.
        
        // Prevent browser default behavior (like auto-scroll)
        e.preventDefault();
        e.stopPropagation();

        let keyName = "";
        if (e.button === 1) {
            keyName = "MMB";
        } else if (e.button === 3) {
            keyName = "X1";
        } else if (e.button === 4) {
            keyName = "X2";
        } else {
            // Left (0) or Right (2) - usually we might want to cancel or allow?
            // If user clicks Left on canvas, maybe they want to cancel?
            // But if they are binding "LMB" to a wheel (weird but possible), we should support it?
            // For now, let's treat Left Click as Cancel if it's not on the button itself.
            // But this handler is attached to document.
            if (e.button === 0) {
                 cleanup();
                 setStatus('已取消按键录制', '', 1500);
                 return;
            }
            if (e.button === 2) {
                 // Right click context menu might interfere, but we prevented default.
                 keyName = "RMB";
            }
        }

        if (keyName) {
            cleanup();
            setStatus(`已识别按键: ${keyName}`, '#4caf50', 2000);
            
            // Map Mouse Buttons to VK
            let vk = 0;
            if (keyName === "LMB") vk = 1;
            else if (keyName === "RMB") vk = 2;
            else if (keyName === "MMB") vk = 4;
            else if (keyName === "X1") vk = 5;
            else if (keyName === "X2") vk = 6;
            
            if (callback) callback(keyName, vk);
        }
    };

    const cleanup = () => {
        document.removeEventListener('keydown', keyHandler, { capture: true });
        document.removeEventListener('mousedown', mouseHandler, { capture: true });
        document.removeEventListener('contextmenu', preventContext, { capture: true });
    };

    const preventContext = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    document.addEventListener('keydown', keyHandler, { capture: true });
    document.addEventListener('mousedown', mouseHandler, { capture: true });
    document.addEventListener('contextmenu', preventContext, { capture: true });
}

// Add double-click listeners to key inputs
function setupKeyRecorder(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    input.addEventListener('dblclick', () => {
        input.style.backgroundColor = '#e0f7fa'; // Highlight
        input.value = "请按键...";
        listenForKey((key) => {
            input.value = key;
            input.style.backgroundColor = '';
            // Trigger change event manually if needed
            input.dispatchEvent(new Event('change'));
        });
    });
    
    // Add tooltip if not present
    if (!input.title) {
        input.title = "双击此处可直接录制按键";
    } else {
        input.title += " (双击可录制)";
    }
}

// Initialize recorders
setupKeyRecorder('toggleKeyInput');
setupKeyRecorder('overlayKeyInput');
setupKeyRecorder('wheelModifierKey');

// Scroll Buttons
btnSetScrollUp.addEventListener('click', () => {
    if (scrollUpMode.value === 'none') {
        setStatus('请先在左侧选择模式 (点击或滑动)', 'red', 2500);
        return;
    }
    pendingScrollSet = { type: 'scrollUp', step: 0 };
    canvas.classList.add('pending');
    const hint = scrollUpMode.value === 'tap' ? '点击画布设置滚轮上滑点击位置 | ESC 取消' : '点击画布设置滚轮上滑起始点 | ESC 取消';
    showCanvasHint(hint, true);
    setStatus(scrollUpMode.value === 'tap' ? '请点击设置点击位置' : '请点击设置滑动起始点', 'blue');
});
btnSetScrollDown.addEventListener('click', () => {
    if (scrollDownMode.value === 'none') {
        setStatus('请先在左侧选择模式 (点击或滑动)', 'red', 2500);
        return;
    }
    pendingScrollSet = { type: 'scrollDown', step: 0 };
    canvas.classList.add('pending');
    const hint = scrollDownMode.value === 'tap' ? '点击画布设置滚轮下滑点击位置 | ESC 取消' : '点击画布设置滚轮下滑起始点 | ESC 取消';
    showCanvasHint(hint, true);
    setStatus(scrollDownMode.value === 'tap' ? '请点击设置点击位置' : '请点击设置滑动起始点', 'blue');
});
scrollUpMode.addEventListener('change', () => {
    scrollUpConfig.mode = scrollUpMode.value;
    draw();
});
scrollDownMode.addEventListener('change', () => {
    scrollDownConfig.mode = scrollDownMode.value;
    draw();
});

// Add Buttons
function startAddKey(name) {
    pendingKeyName = name;
    canvas.classList.add('pending');
    showCanvasHint(`点击画布放置 [${name}] | ESC 取消`, true);
    setStatus(`请点击画布设置 [${name}] 的位置`, 'blue');
}
if (btnAddLMB) btnAddLMB.addEventListener('click', () => startAddKey('LMB'));
if (btnAddRMB) btnAddRMB.addEventListener('click', () => startAddKey('RMB'));
if (btnAddSide1) btnAddSide1.addEventListener('click', () => startAddKey('X1'));
if (btnAddSide2) btnAddSide2.addEventListener('click', () => startAddKey('X2'));
if (btnAddCustom) {
    btnAddCustom.addEventListener('click', () => {
        listenForKey((keyName) => {
            startAddKey(keyName);
        });
    });
}
btnAddWheel.addEventListener('click', () => {
    wheelCenter = { x: canvas.width/4, y: canvas.height/2, radius: parseInt(wheelRadiusInput.value||160) };
    markDirty();
    draw();
});
btnAddMouseWheel.addEventListener('click', () => {
    setStatus('请按下要绑定轮盘的按键...', 'blue');
    listenForKey((key) => {
        mouseWheels.push({
            key: key,
            x: canvas.width/2,
            y: canvas.height/2,
            radius: 100,
            triggerTime: 0
        });
        markDirty();
        draw();
    });
});
btnAddView.addEventListener('click', () => {
    viewCenter = { x: canvas.width*3/4, y: canvas.height/2, width: DEFAULT_VIEW_W, height: DEFAULT_VIEW_H };
    markDirty();
    draw();
});

// Image Upload
imgInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
        const img = new Image();
        img.onload = () => {
            bgImg = img;
            canvas.width = img.width;
            canvas.height = img.height;
            targetWInput.value = img.width;
            targetHInput.value = img.height;
            draw();
        };
        img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
});

// Reference Resolution Change Handlers
function updateCanvasSize() {
    const w = parseInt(targetWInput.value, 10);
    const h = parseInt(targetHInput.value, 10);
    if (w > 0 && h > 0) {
        canvas.width = w;
        canvas.height = h;
        draw();
    }
}
targetWInput.addEventListener('change', updateCanvasSize);
targetHInput.addEventListener('change', updateCanvasSize);

// Save
saveBtn.addEventListener('click', async () => {
    const refW = parseInt(targetWInput.value || '1080', 10);
    const refH = parseInt(targetHInput.value || '2400', 10);

    // Helper to normalize
    const normX = (v) => parseFloat((v / refW).toFixed(4));
    const normY = (v) => parseFloat((v / refH).toFixed(4));
    const normR = (v) => parseFloat((v / refH).toFixed(4)); // Radius normalized by Height

    // Clean keyMap
    const cleanKeyMap = {};
    Object.entries(keyMap).forEach(([k, v]) => {
        cleanKeyMap[k] = {
            x: normX(v.x),
            y: normY(v.y),
            radius: normR(v.radius)
        };
    });

    const payload = {
        port: portInput.value || "COM5",
        rotation: parseInt(rotationInput.value || "0", 10),
        toggleKey: toggleKeyInput.value || "ALT",
        overlayKey: overlayKeyInput.value || "F8",
        overlayScale: parseFloat(overlayScaleInput.value || "1.0"),
        uiReferenceWidth: refW,
        uiReferenceHeight: refH,
        keyMap: cleanKeyMap,
        movementWheel: wheelCenter ? { 
            center: {x: normX(wheelCenter.x), y: normY(wheelCenter.y)}, 
            radius: normR(wheelCenter.radius),
            walkRadius: normR(parseFloat(wheelWalkRadius.value || (wheelCenter.radius * 0.5).toString())),
            modifierKey: wheelModifierKey.value || "",
            stiffness: parseFloat(wheelStiffness.value || "0.015"),
            damping: parseFloat(wheelDamping.value || "0.25")
        } : null,
        mouseWheels: mouseWheels.map(mw => ({
            key: mw.key,
            x: normX(mw.x),
            y: normY(mw.y),
            radius: normR(mw.radius),
            triggerTime: mw.triggerTime || 0
        })),
        viewArea: viewCenter ? {
            center: {x: normX(viewCenter.x), y: normY(viewCenter.y)},
            width: normX(viewCenter.width),
            height: normY(viewCenter.height),
            anchored: true, 
            button: viewBindLMBInput.checked ? 'LMB' : '', 
            sensitivity: parseFloat(viewSensitivityInput.value || '1.0'),
            acceleration: parseFloat(viewAcceleration.value || '0.0'),
            autoReleaseTimeMs: parseInt(viewAutoReleaseInput.value || '0', 10)
        } : null,
        scrollUp: scrollUpConfig.mode !== 'none' ? {
            mode: scrollUpConfig.mode,
            x: normX(scrollUpConfig.x || 0),
            y: normY(scrollUpConfig.y || 0),
            startX: normX(scrollUpConfig.startX || 0),
            startY: normY(scrollUpConfig.startY || 0),
            endX: normX(scrollUpConfig.endX || 0),
            endY: normY(scrollUpConfig.endY || 0),
            duration: parseInt(scrollDuration.value || '200', 10)
        } : null,
        scrollDown: scrollDownConfig.mode !== 'none' ? {
            mode: scrollDownConfig.mode,
            x: normX(scrollDownConfig.x || 0),
            y: normY(scrollDownConfig.y || 0),
            startX: normX(scrollDownConfig.startX || 0),
            startY: normY(scrollDownConfig.startY || 0),
            endX: normX(scrollDownConfig.endX || 0),
            endY: normY(scrollDownConfig.endY || 0),
            duration: parseInt(scrollDuration.value || '200', 10)
        } : null,
        
        // vPointer
        vPointerIp: document.getElementById('vPointerIp').value || "192.168.1.100",
        vPointerPort: parseInt(document.getElementById('vPointerPort').value || "6533", 10),
        vPointerRotation: parseInt(document.getElementById('vPointerRotation').value || "0", 10),
        enableVPointer: document.getElementById('enableVPointer').checked,

        antiCheat: {
            initDirAngleRange: parseFloat(document.getElementById('acInitAngle').value || "0.35"),
            initRadiusScaleRange: parseFloat(document.getElementById('acInitScale').value || "0.1"),
            microMoveSpeed: parseFloat(document.getElementById('acMicroSpeed').value || "0.05"),
            microMoveRange: parseFloat(document.getElementById('acMicroRange').value || "0.008"),
            microMoveDelayMs: parseInt(document.getElementById('acMicroDelay').value || "1000", 10),
            randomOffsetRange: parseFloat(document.getElementById('acRandomOffset').value || "0.005"),
            // Default unused params
            driftHoldTimeMin: 200, driftHoldTimeMax: 1500,
            driftDurationMin: 50, driftDurationMax: 150
        },

        macros: macros,
        sendIntervalMs: parseInt(sendIntervalInput.value || 8),
        pollingRate: parseInt(pollingRateInput.value || 0),
        license: licenseInput.value.trim()
    };

    try {
        const resp = await fetch('/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (resp.ok) {
            setStatus('配置保存成功！', 'green', 3000);
            clearDirty();
        } else {
            setStatus('保存失败: ' + await resp.text(), 'red');
        }
    } catch (e) {
        setStatus('保存失败：无法连接到发送端程序，请先运行 QInETouch.exe', 'red');
    }
});

// Load
loadBtn.addEventListener('click', async () => {
    try {
        const resp = await fetch('/load');
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        
        // Populate inputs
        if (data.port) portInput.value = data.port;
        if (data.rotation !== undefined) rotationInput.value = data.rotation;
        if (data.toggleKey) toggleKeyInput.value = data.toggleKey;
        if (data.overlayKey) overlayKeyInput.value = data.overlayKey;
        if (data.overlayScale) overlayScaleInput.value = data.overlayScale;
        if (data.sendIntervalMs) sendIntervalInput.value = data.sendIntervalMs;
        if (data.pollingRate) {
            pollingRateInput.value = data.pollingRate;
            sendIntervalInput.value = Math.round(1000 / data.pollingRate);
            sendIntervalInput.disabled = true;
            sendIntervalInput.title = "已启用回报率，间隔由回报率自动计算";
        }
        
        // Canvas Size?
        // Priority: Image -> uiReferenceWidth -> LegacyTargetWidth -> Default
        let refW = 1080;
        let refH = 2400;

        if (data.uiReferenceWidth && data.uiReferenceHeight) {
            refW = data.uiReferenceWidth;
            refH = data.uiReferenceHeight;
        } else if (data.targetWidth && data.targetHeight) {
             // Legacy fallback
            refW = data.targetWidth;
            refH = data.targetHeight;
        }

        if (!bgImg) {
            canvas.width = refW;
            canvas.height = refH;
            targetWInput.value = refW;
            targetHInput.value = refH;
        } else {
            // If image loaded, use image size, but keep refW/refH for denormalization if needed?
            // Actually, if image is loaded, user wants to map to THIS image.
            // So we should map normalized coords to CURRENT canvas size.
            refW = canvas.width;
            refH = canvas.height;
            targetWInput.value = refW;
            targetHInput.value = refH;
        }

        // Helpers to denormalize
        // If val <= 1.0, treat as normalized. Else treat as pixels (legacy).
        // Note: Coordinates can be > 1.0 if outside screen? Unlikely for valid config.
        const denormX = (v) => (v <= 1.0 && v >= 0) ? v * refW : v;
        const denormY = (v) => (v <= 1.0 && v >= 0) ? v * refH : v;
        const denormR = (v) => (v <= 1.0 && v >= 0) ? v * refH : v; 

        // Populate KeyMap
        keyMap = {};
        if (data.keyMap) {
            Object.entries(data.keyMap).forEach(([k, v]) => {
                keyMap[k] = {
                    x: denormX(v.x), 
                    y: denormY(v.y), 
                    radius: denormR(v.radius || (DEFAULT_KEY_RADIUS/refH)) // If missing, use default ratio
                };
                // Safety check for radius if it became 0 or tiny
                if (keyMap[k].radius < 5) keyMap[k].radius = DEFAULT_KEY_RADIUS;
            });
        }
        
        // Populate Wheel
        if (data.movementWheel) {
            wheelCenter = {
                x: denormX(data.movementWheel.center.x),
                y: denormY(data.movementWheel.center.y),
                radius: denormR(data.movementWheel.radius)
            };
            if (wheelCenter.radius < 10) wheelCenter.radius = 160;
            wheelRadiusInput.value = Math.round(wheelCenter.radius);

            // Populate Walk Radius & Modifier
            const wR = denormR(data.movementWheel.walkRadius || 0);
            wheelWalkRadius.value = wR > 0 ? Math.round(wR) : Math.round(wheelCenter.radius * 0.5);
            wheelModifierKey.value = data.movementWheel.modifierKey || "";
            wheelStiffness.value = data.movementWheel.stiffness || "0.015";
            wheelDamping.value = data.movementWheel.damping || "0.25";

        } else {
            wheelCenter = null;
        }

        // Populate MouseWheels
        mouseWheels = [];
        if (data.mouseWheels && Array.isArray(data.mouseWheels)) {
            mouseWheels = data.mouseWheels.map(mw => ({
                key: mw.key,
                x: denormX(mw.x),
                y: denormY(mw.y),
                radius: denormR(mw.radius),
                triggerTime: mw.triggerTime || 0
            }));
            mouseWheels.forEach(mw => {
                if (mw.radius < 10) mw.radius = 100;
            });
        }
        
        // Populate View
        if (data.viewArea) {
            viewCenter = {
                x: denormX(data.viewArea.center.x),
                y: denormY(data.viewArea.center.y),
                width: denormX(data.viewArea.width),
                height: denormY(data.viewArea.height)
            };
            if (viewCenter.width < 10) viewCenter.width = DEFAULT_VIEW_W;
            if (viewCenter.height < 10) viewCenter.height = DEFAULT_VIEW_H;

            if (data.viewArea.sensitivity) {
                viewSensitivityInput.value = data.viewArea.sensitivity;
            }
            if (data.viewArea.acceleration) {
                viewAcceleration.value = data.viewArea.acceleration;
            }
            if (data.viewArea.autoReleaseTimeMs) {
                viewAutoReleaseInput.value = data.viewArea.autoReleaseTimeMs;
            } else {
                viewAutoReleaseInput.value = 0;
            }
            if (data.viewArea.button === 'LMB') {
            viewBindLMBInput.checked = true;
        } else {
            viewBindLMBInput.checked = false;
        }
    } else {
        viewCenter = null;
        viewBindLMBInput.checked = true; // 默认勾选，保持向下兼容
    }

    // Populate Scroll
    if (data.scrollUp) {
        scrollUpMode.value = data.scrollUp.mode || 'none';
        scrollUpConfig = {
            mode: data.scrollUp.mode || 'none',
            x: denormX(data.scrollUp.x || 0),
            y: denormY(data.scrollUp.y || 0),
            startX: denormX(data.scrollUp.startX || 0),
            startY: denormY(data.scrollUp.startY || 0),
            endX: denormX(data.scrollUp.endX || 0),
            endY: denormY(data.scrollUp.endY || 0),
            duration: data.scrollUp.duration || 200
        };
        if (data.scrollUp.duration) scrollDuration.value = data.scrollUp.duration;
    } else {
        scrollUpMode.value = 'none';
        scrollUpConfig = { mode: 'none' };
    }
    if (data.scrollDown) {
        scrollDownMode.value = data.scrollDown.mode || 'none';
        scrollDownConfig = {
            mode: data.scrollDown.mode || 'none',
            x: denormX(data.scrollDown.x || 0),
            y: denormY(data.scrollDown.y || 0),
            startX: denormX(data.scrollDown.startX || 0),
            startY: denormY(data.scrollDown.startY || 0),
            endX: denormX(data.scrollDown.endX || 0),
            endY: denormY(data.scrollDown.endY || 0),
            duration: data.scrollDown.duration || 200
        };
        // If scrollDown has diff duration, it might overwrite UI, but we share one input for simplicity
    } else {
        scrollDownMode.value = 'none';
        scrollDownConfig = { mode: 'none' };
    }
    
    // Populate vPointer
    if (data.vPointerIp) document.getElementById('vPointerIp').value = data.vPointerIp;
    if (data.vPointerPort) document.getElementById('vPointerPort').value = data.vPointerPort;
    if (data.vPointerRotation !== undefined) document.getElementById('vPointerRotation').value = data.vPointerRotation;
    if (data.enableVPointer !== undefined) document.getElementById('enableVPointer').checked = data.enableVPointer;

    if (data.license) {
        licenseInput.value = data.license;
    }
    
    // Populate AntiCheat
    if (data.antiCheat) {
        if (data.antiCheat.initDirAngleRange !== undefined) document.getElementById('acInitAngle').value = data.antiCheat.initDirAngleRange;
        if (data.antiCheat.initRadiusScaleRange !== undefined) document.getElementById('acInitScale').value = data.antiCheat.initRadiusScaleRange;
        if (data.antiCheat.microMoveSpeed !== undefined) document.getElementById('acMicroSpeed').value = data.antiCheat.microMoveSpeed;
        if (data.antiCheat.microMoveRange !== undefined) document.getElementById('acMicroRange').value = data.antiCheat.microMoveRange;
        if (data.antiCheat.microMoveDelayMs !== undefined) document.getElementById('acMicroDelay').value = data.antiCheat.microMoveDelayMs;
        if (data.antiCheat.randomOffsetRange !== undefined) document.getElementById('acRandomOffset').value = data.antiCheat.randomOffsetRange;
    }

    // Populate Macros
    if (data.macros) {
        macros = data.macros;
    } else {
        macros = [];
    }
    renderMacroList();
    
    setStatus('配置已加载', 'green', 3000);
        clearDirty();
        draw();
        
    } catch (e) {
        setStatus('加载失败：无法连接到发送端程序，请先运行 QInETouch.exe', 'red');
    }
});

// Device Info Polling
function pollDeviceInfo() {
    fetch('/device_info')
    .then(res => res.json())
    .then(data => {
        // data: { connected: bool, mac: string, status: string, lastSeen: int64 }
        const now = Math.floor(Date.now() / 1000);
        const isOnline = data.connected && (now - data.lastSeen < 5); // 5s timeout
        
        if (isOnline) {
            connStatus.innerText = '已连接';
            connStatus.style.color = 'green';
            macAddr.innerText = data.mac || '获取中...';
            
            if (data.status === 'active') {
                authStatus.innerText = '已激活';
                authStatus.style.color = 'green';
            } else if (data.status === 'auth_required') {
                authStatus.innerText = '未激活 (功能受限)';
                authStatus.style.color = 'red';
            } else {
                authStatus.innerText = '未知 / 正常';
                authStatus.style.color = '#666';
            }
        } else {
            connStatus.innerText = '未连接 (请运行发送端)';
            connStatus.style.color = 'red';
            macAddr.innerText = '-';
            authStatus.innerText = '-';
        }
    })
    .catch(() => {
        connStatus.innerText = '未连接 (发送端未运行)';
        connStatus.style.color = 'red';
    });
}

// Start polling every 2s
setInterval(pollDeviceInfo, 2000);
pollDeviceInfo(); // immediate

// ==========================================
// Property Panel
// ==========================================
const propPanel = document.getElementById('propPanel');
const propPanelTitle = document.getElementById('propPanelTitle');
const propPanelContent = document.getElementById('propPanelContent');
const propPanelHeader = document.getElementById('propPanelHeader');

function showPropPanel(type) {
    propPanel.style.display = 'flex';
    let html = '';
    if (type === 'wheel') {
        propPanelTitle.textContent = 'WASD 轮盘属性';
        html = `
        <div class="param-row"><label title="轮盘半径">半径:</label><input id="pp_wheelRadius" type="number" class="small-input" value="${wheelRadiusInput.value}"></div>
        <div class="param-row"><label title="静步键">静步键:</label><input id="pp_wheelModifierKey" type="text" class="small-input" value="${wheelModifierKey.value}" placeholder="SHIFT"></div>
        <div class="param-row"><label title="静步半径">静步半径:</label><input id="pp_wheelWalkRadius" type="number" class="small-input" value="${wheelWalkRadius.value}"></div>
        <div class="param-row"><label title="弹簧刚度 (默认0.015)">刚度:</label><input id="pp_wheelStiffness" type="number" step="0.001" class="small-input" value="${wheelStiffness.value}"></div>
        <div class="param-row"><label title="阻尼系数 (默认0.25)">阻尼:</label><input id="pp_wheelDamping" type="number" step="0.01" class="small-input" value="${wheelDamping.value}"></div>
        `;
    } else if (type === 'mouseWheel') {
        propPanelTitle.textContent = '鼠标轮盘属性';
        html = `
        <div class="param-row"><label>半径:</label><input id="pp_wheelRadius" type="number" class="small-input" value="${wheelRadiusInput.value}"></div>
        <div class="param-row"><label title="长按进入轮盘(ms)">长按(ms):</label><input id="pp_wheelTriggerTime" type="number" class="small-input" value="${wheelTriggerTimeInput.value}"></div>
        `;
    } else if (type === 'view') {
        propPanelTitle.textContent = '视角区属性';
        html = `
        <div class="param-row"><label>灵敏度:</label><input id="pp_viewSensitivity" type="number" step="0.1" class="small-input" value="${viewSensitivityInput.value}"></div>
        <div class="param-row"><label title="加速度 (0=禁用)">加速度:</label><input id="pp_viewAcceleration" type="number" step="0.1" class="small-input" value="${viewAcceleration.value}"></div>
        <div class="param-row"><label title="静止自动抬起(ms), 0禁用">自动抬起:</label><input id="pp_viewAutoRelease" type="number" class="small-input" value="${viewAutoReleaseInput.value}"></div>
        <div class="param-row"><label>绑左键:</label><input id="pp_viewBindLMB" type="checkbox" ${viewBindLMBInput.checked ? 'checked' : ''}></div>
        `;
    } else if (type === 'key') {
        propPanelTitle.textContent = '按键属性';
        html = `
        <div class="param-row"><label>半径:</label><input id="pp_wheelRadius" type="number" class="small-input" value="${wheelRadiusInput.value}"></div>
        `;
    }
    propPanelContent.innerHTML = html;

    // Wire up key recorder for modifier key input (dynamically created)
    setupKeyRecorder('pp_wheelModifierKey');

    // Wire up real-time sync back to hidden inputs
    const bind = (ppId, hiddenInput, isCheckbox) => {
        const el = document.getElementById(ppId);
        if (!el) return;
        el.addEventListener(isCheckbox ? 'change' : 'input', () => {
            if (isCheckbox) hiddenInput.checked = el.checked;
            else hiddenInput.value = el.value;
            markDirty();
        });
    };
    bind('pp_wheelRadius', wheelRadiusInput);
    bind('pp_wheelModifierKey', wheelModifierKey);
    bind('pp_wheelWalkRadius', wheelWalkRadius);
    bind('pp_wheelStiffness', wheelStiffness);
    bind('pp_wheelDamping', wheelDamping);
    bind('pp_wheelTriggerTime', wheelTriggerTimeInput);
    bind('pp_viewSensitivity', viewSensitivityInput);
    bind('pp_viewAcceleration', viewAcceleration);
    bind('pp_viewAutoRelease', viewAutoReleaseInput);
    bind('pp_viewBindLMB', viewBindLMBInput, true);
}

function hidePropPanel() {
    propPanel.style.display = 'none';
    propPanelContent.innerHTML = '';
}

// Drag for propPanel
(function setupPropPanelDrag() {
    let dragging = false, ox = 0, oy = 0;
    propPanelHeader.addEventListener('mousedown', (e) => {
        dragging = true;
        ox = e.clientX - propPanel.getBoundingClientRect().left;
        oy = e.clientY - propPanel.getBoundingClientRect().top;
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        propPanel.style.right = 'auto';
        propPanel.style.bottom = 'auto';
        propPanel.style.left = (e.clientX - ox) + 'px';
        propPanel.style.top = (e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
})();

init();
