const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const imgInput = document.getElementById('imgInput');
const targetWInput = document.getElementById('targetW');
const targetHInput = document.getElementById('targetH');
const statusDiv = document.getElementById('status');

// 输入控件
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

// 滚动配置
const scrollUpMode = document.getElementById('scrollUpMode');
const btnSetScrollUp = document.getElementById('btnSetScrollUp');
const scrollDownMode = document.getElementById('scrollDownMode');
const btnSetScrollDown = document.getElementById('btnSetScrollDown');
const scrollDuration = document.getElementById('scrollDuration');

// 激活状态
const licenseInput = document.getElementById('licenseInput');
const connStatus = document.getElementById('connStatus');
const macAddr = document.getElementById('macAddr');
const authStatus = document.getElementById('authStatus');

// 按钮
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

// 状态变量
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

let selected = null; // { type: 'key'|'wheel'|'view'|'mouseWheel', id: string|null|index }
let interaction = null; // { type: 'drag'|'resize', startX, startY, origProps, handle? }
let pendingKeyName = null;
let pendingScrollSet = null; // { type: 'scrollUp'|'scrollDown', step: 0 } 

// 初始化
/**
 * 初始化画布和应用状态
 */
function init() {
    canvas.width = 1080;
    canvas.height = 2400;
    ctx.font = 'bold 48px Arial'; // 增大字体大小
    draw();
}

// 工具栏逻辑
const toolbar = document.getElementById('toolbar');
const toolbarHeader = document.getElementById('toolbarHeader');
const toolbarToggle = document.getElementById('toolbarToggle');

// 拖拽逻辑
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
        
        // 简单边界检查
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

// 折叠切换
toolbarToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toolbar.classList.toggle('panel-collapsed');
    toolbarToggle.innerText = toolbar.classList.contains('panel-collapsed') ? '+' : '−';
});

// 子面板逻辑
const subPanel = document.getElementById('subPanel');
const subPanelTitle = document.getElementById('subPanelTitle');
const subPanelContent = document.getElementById('subPanelContent');
let currentSource = null;

/**
 * 打开指定模块的子面板
 * @param {string} moduleId - 模块ID
 */
function openSubPanel(moduleId) {
    const titles = {
        'basic': '基础设置 & 截图',
        'components': '添加组件 (拖拽)',
        'scroll': '鼠标滚轮配置',
        'advanced': '高级参数微调',
        'activation': '设备激活 & 状态'
    };
    
    // 1. 如果有当前内容，先移回原处
    if (currentSource) {
        const sourceDiv = document.getElementById('source-' + currentSource);
        if (sourceDiv) {
            while (subPanelContent.firstChild) {
                sourceDiv.appendChild(subPanelContent.firstChild);
            }
        }
    }

    // 2. 如果点击的是同一个模块，则关闭
    if (currentSource === moduleId && subPanel.style.display !== 'none') {
        closeSubPanel();
        return;
    }

    // 3. 将新内容移动到子面板
    const newSourceDiv = document.getElementById('source-' + moduleId);
    if (newSourceDiv) {
        while (newSourceDiv.firstChild) {
            subPanelContent.appendChild(newSourceDiv.firstChild);
        }
    }

    // 4. 更新 UI
    subPanelTitle.innerText = titles[moduleId] || '配置';
    subPanel.style.display = 'flex';
    currentSource = moduleId;

    // 将子面板定位在工具栏旁边
    const rect = toolbar.getBoundingClientRect();
    subPanel.style.left = (rect.right + 10) + 'px';
    subPanel.style.top = rect.top + 'px';
}

/**
 * 关闭子面板
 */
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

// 使子面板也可拖拽
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
 * 绘制所有内容
 */
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景
    if (bgImg) {
        ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
    } else {
        ctx.fillStyle = '#eee';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#999';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 60px Arial'; // 增大提示文字
        ctx.fillText('请上传游戏截图以开始配置', canvas.width/2, canvas.height/2);
    }

    // 绘制方向轮盘
    if (wheelCenter) {
        drawCircleComponent(wheelCenter.x, wheelCenter.y, wheelCenter.radius, 'WASD', 'rgba(255, 165, 0, 0.8)', 'rgba(255, 165, 0, 0.4)');
    }

    // 绘制鼠标滚轮
    mouseWheels.forEach((mw, idx) => {
        drawCircleComponent(mw.x, mw.y, mw.radius, 'MW:' + mw.key, 'rgba(153, 50, 204, 0.8)', 'rgba(153, 50, 204, 0.4)');
    });

    // 绘制视角区域
    if (viewCenter) {
        drawRectComponent(viewCenter.x, viewCenter.y, viewCenter.width, viewCenter.height, 'VIEW', 'rgba(0, 255, 127, 0.8)', 'rgba(0, 255, 127, 0.4)');
    }

    // 绘制滚动动作
    const drawScroll = (cfg, label) => {
        if (cfg.mode === 'tap') {
            drawCircleComponent(cfg.x, cfg.y, 40, label + '(Tap)', 'rgba(255, 0, 0, 0.8)', 'rgba(255, 0, 0, 0.2)');
        } else if (cfg.mode === 'swipe') {
            // 绘制起点
            drawCircleComponent(cfg.startX, cfg.startY, 30, label + ' S', 'rgba(0, 200, 255, 0.8)', 'rgba(0, 200, 255, 0.4)');
            // 绘制终点
            drawCircleComponent(cfg.endX, cfg.endY, 30, label + ' E', 'rgba(0, 200, 255, 0.8)', 'rgba(0, 200, 255, 0.4)');
            // 绘制箭头
            ctx.beginPath();
            ctx.moveTo(cfg.startX, cfg.startY);
            ctx.lineTo(cfg.endX, cfg.endY);
            ctx.strokeStyle = 'rgba(0, 200, 255, 0.8)';
            ctx.lineWidth = 8;
            ctx.stroke();
            // 箭头头部
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

    // 绘制按键
    Object.entries(keyMap).forEach(([key, pos]) => {
        let color = '#007bff';
        if (['LMB', 'RMB', 'X1', 'X2'].includes(key)) color = '#e91e63';
        const fillColor = hexToRgba(color, 0.4);
        drawCircleComponent(pos.x, pos.y, pos.radius, key, color, fillColor);
    });

    // 绘制选中项（手柄和删除按钮）
    if (selected) {
        drawSelectionOverlay();
    }
}

/**
 * 将十六进制颜色转换为 RGBA 格式
 * @param {string} hex - 十六进制颜色值
 * @param {number} alpha - 透明度 (0-1)
 * @returns {string} RGBA 颜色字符串
 */
function hexToRgba(hex, alpha) {
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * 绘制圆形组件
 * @param {number} x - 圆心 X 坐标
 * @param {number} y - 圆心 Y 坐标
 * @param {number} r - 半径
 * @param {string} label - 标签文本
 * @param {string} strokeColor - 描边颜色
 * @param {string} fillColor - 填充颜色
 */
function drawCircleComponent(x, y, r, label, strokeColor, fillColor) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 5; // 加粗线条
    ctx.stroke();

    // 标签
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 根据半径动态调整字体大小，最小 24px
    ctx.font = 'bold ' + Math.max(24, r/1.5) + 'px Arial';
    ctx.fillText(label, x, y);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeText(label, x, y);
}

/**
 * 绘制矩形组件
 * @param {number} x - 中心 X 坐标
 * @param {number} y - 中心 Y 坐标
 * @param {number} w - 宽度
 * @param {number} h - 高度
 * @param {string} label - 标签文本
 * @param {string} strokeColor - 描边颜色
 * @param {string} fillColor - 填充颜色
 */
function drawRectComponent(x, y, w, h, label, strokeColor, fillColor) {
    const left = x - w/2;
    const top = y - h/2;
    ctx.fillStyle = fillColor;
    ctx.fillRect(left, top, w, h);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, w, h);

    // 标签
    ctx.fillStyle = 'white';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 24px Arial';
    ctx.fillText(label, x, y);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 1;
    ctx.strokeText(label, x, y);
}

/**
 * 绘制选中项的覆盖层（边界框、手柄、删除按钮）
 */
function drawSelectionOverlay() {
    let bounds = getBounds(selected);
    if (!bounds) return;

    // 绘制边界框 (用于视觉清晰)
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
    ctx.setLineDash([]);

    // 绘制调整手柄 (角点)
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

    // 绘制删除按钮 (右上角)
    const delX = bounds.x + bounds.w;
    const delY = bounds.y;
    ctx.beginPath();
    ctx.arc(delX, delY, DELETE_BTN_SIZE/2, 0, Math.PI*2);
    ctx.fillStyle = 'red';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // X 图标
    ctx.beginPath();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.moveTo(delX - 4, delY - 4);
    ctx.lineTo(delX + 4, delY + 4);
    ctx.moveTo(delX + 4, delY - 4);
    ctx.lineTo(delX - 4, delY + 4);
    ctx.stroke();
}

/**
 * 获取选中项的边界框
 * @param {object} sel - 选中项对象
 * @returns {object|null} 边界框 {x, y, w, h} 或 null
 */
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

/**
 * 获取选中项的调整手柄位置
 * @param {object} sel - 选中项对象
 * @returns {Array} 手柄数组 [{name, x, y}, ...]
 */
function getHandles(sel) {
    const b = getBounds(sel);
    if (!b) return [];
    // 4个角
    return [
        { name: 'tl', x: b.x, y: b.y },
        { name: 'tr', x: b.x + b.w, y: b.y },
        { name: 'bl', x: b.x, y: b.y + b.h },
        { name: 'br', x: b.x + b.w, y: b.y + b.h }
    ];
}

// 辅助函数：检测命中
/**
 * 检测鼠标点击位置命中了哪个元素
 * @param {number} x - 鼠标 X 坐标
 * @param {number} y - 鼠标 Y 坐标
 * @returns {object|null} 命中信息对象 或 null
 */
function checkHit(x, y) {
    // 1. 检查选中项的删除按钮
    if (selected) {
        const b = getBounds(selected);
        if (b) {
            const delX = b.x + b.w;
            const delY = b.y;
            if (Math.hypot(x - delX, y - delY) <= DELETE_BTN_SIZE) {
                return { type: 'delete' };
            }
        }
        // 2. 检查手柄
        const handles = getHandles(selected);
        for (const h of handles) {
            if (Math.hypot(x - h.x, y - h.y) <= HANDLE_SIZE) {
                return { type: 'resize', handle: h.name };
            }
        }
    }

    // 3. 检查项目（按键、轮盘、视角）
    // 逆序检查以选中最上层的元素
    // 按键
    for (const [key, pos] of Object.entries(keyMap)) {
        if (Math.hypot(x - pos.x, y - pos.y) <= pos.radius) {
            return { type: 'select', targetType: 'key', id: key };
        }
    }
    // 轮盘
    if (wheelCenter) {
        if (Math.hypot(x - wheelCenter.x, y - wheelCenter.y) <= wheelCenter.radius) {
            return { type: 'select', targetType: 'wheel', id: 'wheel' };
        }
    }
    // 鼠标滚轮
    for (let i = 0; i < mouseWheels.length; i++) {
        const mw = mouseWheels[i];
        if (Math.hypot(x - mw.x, y - mw.y) <= mw.radius) {
            return { type: 'select', targetType: 'mouseWheel', id: i };
        }
    }
    // 视角
    if (viewCenter) {
        const left = viewCenter.x - viewCenter.width/2;
        const top = viewCenter.y - viewCenter.height/2;
        if (x >= left && x <= left + viewCenter.width && y >= top && y <= top + viewCenter.height) {
            return { type: 'select', targetType: 'view', id: 'view' };
        }
    }

    return null;
}

// 交互逻辑
canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    if (pendingKeyName) {
        keyMap[pendingKeyName] = { x: Math.round(x), y: Math.round(y), radius: DEFAULT_KEY_RADIUS };
        pendingKeyName = null;
        statusDiv.innerText = '按键已添加';
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
            statusDiv.innerText = '滚轮点击位置已设置';
        } else if (mode === 'swipe') {
            if (pendingScrollSet.step === 0) {
                cfg.startX = Math.round(x);
                cfg.startY = Math.round(y);
                pendingScrollSet.step = 1;
                statusDiv.innerText = '已设置起始点，请点击设置结束点';
            } else {
                cfg.endX = Math.round(x);
                cfg.endY = Math.round(y);
                pendingScrollSet = null;
                statusDiv.innerText = '滚轮滑动区域已设置';
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
            
            // 根据选中项更新输入框
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
            draw();
            return;
        }
    } else {
        selected = null;
        draw();
    }
});

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // 鼠标指针样式
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
        // 处理调整大小
        // 对于圆形（按键/轮盘）：根据距中心的距离调整半径
        if (selected.type === 'key' || selected.type === 'wheel' || selected.type === 'mouseWheel') {
            // 简单逻辑：鼠标到中心的距离
            
            let center = { x: orig.x, y: orig.y };
            let newR = Math.hypot(x - center.x, y - center.y);
            if (newR < 10) newR = 10;
            
            if (selected.type === 'key') keyMap[selected.id].radius = newR;
            else if (selected.type === 'wheel') {
                wheelCenter.radius = newR;
                wheelRadiusInput.value = Math.round(newR);
            } else if (selected.type === 'mouseWheel') {
                mouseWheels[selected.id].radius = newR;
            }
        } else if (selected.type === 'view') {
            // 矩形调整大小
            let newX = orig.x;
            let newY = orig.y;
            let newW = orig.width;
            let newH = orig.height;

            // 原始边界
            let left = orig.x - orig.width/2;
            let top = orig.y - orig.height/2;
            let right = orig.x + orig.width/2;
            let bottom = orig.y + orig.height/2;

            if (interaction.handle.includes('l')) left += dx;
            if (interaction.handle.includes('r')) right += dx;
            if (interaction.handle.includes('t')) top += dy;
            if (interaction.handle.includes('b')) bottom += dy;

            // 归一化
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

canvas.addEventListener('mouseup', () => interaction = null);
canvas.addEventListener('mouseleave', () => interaction = null);

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!selected) return;
    
    const delta = e.deltaY > 0 ? -5 : 5;
    if (selected.type === 'key') {
        let r = keyMap[selected.id].radius;
        r += delta;
        if (r < 10) r = 10;
        keyMap[selected.id].radius = r;
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
    } else if (selected.type === 'view') {
        // 同时调整宽/高
        let w = viewCenter.width + delta*2;
        let h = viewCenter.height + delta*2;
        if (w < 20) w = 20;
        if (h < 20) h = 20;
        viewCenter.width = w;
        viewCenter.height = h;
    }
    draw();
}, { passive: false });

// 输入改变处理程序
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

// 辅助函数：监听单个按键或鼠标按钮
/**
 * 监听用户的按键或鼠标点击
 * @param {function} callback - 回调函数
 */
function listenForKey(callback) {
    statusDiv.innerText = '请按下键盘按键或鼠标键... (点击空白处取消)';
    statusDiv.style.color = 'blue';
    
    // 键盘处理程序
    const keyHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        let keyName = "";
        
        // 特殊映射
        const codeMap = {
            "Space": "SPACE",
            "Enter": "ENTER",
            "Escape": "ESC",
            "Tab": "TAB",
            "Backspace": "BACKSPACE",
            "Delete": "DELETE",
            "ArrowUp": "UP",
            "ArrowDown": "DOWN",
            "ArrowLeft": "LEFT",
            "ArrowRight": "RIGHT",
            "ShiftLeft": "LSHIFT",
            "ShiftRight": "RSHIFT",
            "ControlLeft": "LCTRL",
            "ControlRight": "RCTRL",
            "AltLeft": "LALT",
            "AltRight": "RALT",
            "MetaLeft": "LWIN",
            "MetaRight": "RWIN"
        };
        
        if (codeMap[e.code]) {
            keyName = codeMap[e.code];
        } else {
            keyName = e.key.toUpperCase();
            if (keyName.length > 1 && !codeMap[e.code]) {
                // 回退到 code
                keyName = e.code.toUpperCase().replace('KEY', '');
            }
        }
        
        cleanup();
        callback(keyName);
    };
    
    // 鼠标处理程序
    const mouseHandler = (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        let keyName = "";
        switch (e.button) {
            case 0: keyName = "LMB"; break;
            case 1: keyName = "MMB"; break;
            case 2: keyName = "RMB"; break;
            case 3: keyName = "X1"; break;
            case 4: keyName = "X2"; break;
            default: return; // 忽略其他
        }
        
        cleanup();
        callback(keyName);
    };
    
    // 点击空白处取消
    const cancelHandler = (e) => {
        // 忽略在按钮上的点击
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT') return;
        cleanup();
        statusDiv.innerText = '已取消';
        statusDiv.style.color = 'black';
    };

    function cleanup() {
        window.removeEventListener('keydown', keyHandler, true);
        window.removeEventListener('mousedown', mouseHandler, true);
        document.removeEventListener('click', cancelHandler);
    }

    window.addEventListener('keydown', keyHandler, true);
    window.addEventListener('mousedown', mouseHandler, true);
    // 延迟添加取消监听器，以避免触发它的点击
    setTimeout(() => document.addEventListener('click', cancelHandler), 100);
}

// 绑定按钮事件
btnAddWheel.addEventListener('click', () => {
    wheelCenter = { x: canvas.width/2, y: canvas.height/2, radius: 160 };
    wheelRadiusInput.value = 160;
    draw();
});

btnAddMouseWheel.addEventListener('click', () => {
    listenForKey((key) => {
        mouseWheels.push({ key: key, x: canvas.width/2, y: canvas.height/2, radius: 100, triggerTime: 0 });
        draw();
        statusDiv.innerText = `已添加鼠标滚轮: ${key}`;
    });
});

btnAddView.addEventListener('click', () => {
    viewCenter = { x: canvas.width/2, y: canvas.height/3, width: DEFAULT_VIEW_W, height: DEFAULT_VIEW_H };
    draw();
});

btnAddLMB.addEventListener('click', () => {
    pendingKeyName = 'LMB';
    statusDiv.innerText = '请点击屏幕位置以放置 LMB';
});

btnAddRMB.addEventListener('click', () => {
    pendingKeyName = 'RMB';
    statusDiv.innerText = '请点击屏幕位置以放置 RMB';
});

btnAddSide1.addEventListener('click', () => {
    pendingKeyName = 'X1';
    statusDiv.innerText = '请点击屏幕位置以放置侧键1';
});

btnAddSide2.addEventListener('click', () => {
    pendingKeyName = 'X2';
    statusDiv.innerText = '请点击屏幕位置以放置侧键2';
});

btnAddCustom.addEventListener('click', () => {
    listenForKey((key) => {
        pendingKeyName = key;
        statusDiv.innerText = `已捕获 ${key}，请点击屏幕位置以放置`;
    });
});

btnSetScrollUp.addEventListener('click', () => {
    pendingScrollSet = { type: 'scrollUp', step: 0 };
    statusDiv.innerText = scrollUpMode.value === 'swipe' ? '请点击设置起点' : '请点击设置点击位置';
});

btnSetScrollDown.addEventListener('click', () => {
    pendingScrollSet = { type: 'scrollDown', step: 0 };
    statusDiv.innerText = scrollDownMode.value === 'swipe' ? '请点击设置起点' : '请点击设置点击位置';
});

// 保存逻辑
saveBtn.addEventListener('click', async () => {
    const refW = canvas.width;
    const refH = canvas.height;
    
    const normX = (v) => v / refW;
    const normY = (v) => v / refH;
    const normR = (v) => v / refH; 

    // 清理并归一化 KeyMap
    const cleanKeyMap = {};
    Object.entries(keyMap).forEach(([k, v]) => {
        cleanKeyMap[k] = {
            x: normX(v.x),
            y: normY(v.y),
            radius: normR(v.radius)
        };
    });

    const payload = {
        port: portInput.value,
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
            statusDiv.innerText = '配置保存成功！';
            statusDiv.style.color = 'green';
        } else {
            statusDiv.innerText = '保存失败: ' + await resp.text();
            statusDiv.style.color = 'red';
        }
    } catch (e) {
        statusDiv.innerText = '请求错误: ' + e.message;
        statusDiv.style.color = 'red';
    }
});

// 加载逻辑
loadBtn.addEventListener('click', async () => {
    try {
        const resp = await fetch('/load');
        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();
        
        // 填充输入框
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
        
        // 优先级：图片 -> uiReferenceWidth -> LegacyTargetWidth -> 默认
        let refW = 1080;
        let refH = 2400;

        if (data.uiReferenceWidth && data.uiReferenceHeight) {
            refW = data.uiReferenceWidth;
            refH = data.uiReferenceHeight;
        } else if (data.targetWidth && data.targetHeight) {
            refW = data.targetWidth;
            refH = data.targetHeight;
        }

        if (!bgImg) {
            canvas.width = refW;
            canvas.height = refH;
            targetWInput.value = refW;
            targetHInput.value = refH;
        } else {
            refW = canvas.width;
            refH = canvas.height;
            targetWInput.value = refW;
            targetHInput.value = refH;
        }

        // 反归一化辅助函数
        const denormX = (v) => (v <= 1.0 && v >= 0) ? v * refW : v;
        const denormY = (v) => (v <= 1.0 && v >= 0) ? v * refH : v;
        const denormR = (v) => (v <= 1.0 && v >= 0) ? v * refH : v; 

        // 填充按键映射
        keyMap = {};
        if (data.keyMap) {
            Object.entries(data.keyMap).forEach(([k, v]) => {
                keyMap[k] = {
                    x: denormX(v.x), 
                    y: denormY(v.y), 
                    radius: denormR(v.radius || (DEFAULT_KEY_RADIUS/refH)) // 如果缺失，使用默认比例
                };
                // 半径安全检查，如果为0或太小
                if (keyMap[k].radius < 5) keyMap[k].radius = DEFAULT_KEY_RADIUS;
            });
        }
        
        // 填充轮盘
        if (data.movementWheel) {
            wheelCenter = {
                x: denormX(data.movementWheel.center.x),
                y: denormY(data.movementWheel.center.y),
                radius: denormR(data.movementWheel.radius)
            };
            if (wheelCenter.radius < 10) wheelCenter.radius = 160;
            wheelRadiusInput.value = Math.round(wheelCenter.radius);

            // 填充行走半径和修饰键
            const wR = denormR(data.movementWheel.walkRadius || 0);
            wheelWalkRadius.value = wR > 0 ? Math.round(wR) : Math.round(wheelCenter.radius * 0.5);
            wheelModifierKey.value = data.movementWheel.modifierKey || "";
            wheelStiffness.value = data.movementWheel.stiffness || "0.015";
            wheelDamping.value = data.movementWheel.damping || "0.25";

        } else {
            wheelCenter = null;
        }

        // 填充鼠标滚轮
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
        
        // 填充视角
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

    // 填充滚动
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
        // 如果 scrollDown 有不同的持续时间，可能会覆盖 UI，但为了简单起见，我们共享一个输入框
    } else {
        scrollDownMode.value = 'none';
        scrollDownConfig = { mode: 'none' };
    }

    if (data.license) {
        licenseInput.value = data.license;
    }
    
    statusDiv.innerText = '配置已加载 (归一化转换完成)';
        statusDiv.style.color = 'green';
        draw();
        
    } catch (e) {
        statusDiv.innerText = '加载失败: ' + e.message;
        statusDiv.style.color = 'red';
    }
});

// 设备信息轮询
/**
 * 轮询设备信息
 */
function pollDeviceInfo() {
    fetch('/device_info')
    .then(res => res.json())
    .then(data => {
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
        connStatus.innerText = '服务连接失败';
        connStatus.style.color = 'red';
    });
}

// 每2秒轮询一次
setInterval(pollDeviceInfo, 2000);
pollDeviceInfo(); // 立即执行

init();
