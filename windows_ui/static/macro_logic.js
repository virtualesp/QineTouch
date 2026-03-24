
// ==========================================
// Macro System Logic (Localized & Improved)
// ==========================================

// Mapping for Display
const ACTION_TYPES = {
    11: '触摸点击(TouchClick)',
    12: '触摸滑动(Swipe)',
    9: '触摸按下(TouchDown)',
    10: '触摸抬起(TouchUp)',
    13: '设置FPS模式',
    14: '设置遮罩层',
    0: '延迟(Delay)'
};

const TRIGGER_MODES = {
    0: '单次触发',
    1: '长按循环',
    2: '按下切换',
    3: '序列执行'
};

const MOUSE_BUTTONS = {
    1: '左键 (LMB)',
    2: '右键 (RMB)',
    4: '中键 (MMB)',
    5: '侧键1 (X1)',
    6: '侧键2 (X2)'
};

// Common VK Codes map for display
const VK_MAP = {
    1: '左键', 2: '右键', 4: '中键', 5: '侧键1', 6: '侧键2',
    8: '退格(Backspace)', 9: '制表(Tab)', 13: '回车(Enter)', 16: 'Shift', 17: 'Ctrl', 18: 'Alt',
    20: '大小写(CapsLock)', 27: '退出(Esc)', 32: '空格(Space)', 33: '上翻页(PgUp)', 34: '下翻页(PgDn)',
    35: '末尾(End)', 36: '起始(Home)', 37: '左(Left)', 38: '上(Up)', 39: '右(Right)', 40: '下(Down)',
    45: '插入(Insert)', 46: '删除(Delete)',
    48: '0', 49: '1', 50: '2', 51: '3', 52: '4', 53: '5', 54: '6', 55: '7', 56: '8', 57: '9',
    65: 'A', 66: 'B', 67: 'C', 68: 'D', 69: 'E', 70: 'F', 71: 'G', 72: 'H', 73: 'I', 74: 'J',
    75: 'K', 76: 'L', 77: 'M', 78: 'N', 79: 'O', 80: 'P', 81: 'Q', 82: 'R', 83: 'S', 84: 'T',
    85: 'U', 86: 'V', 87: 'W', 88: 'X', 89: 'Y', 90: 'Z',
    112: 'F1', 113: 'F2', 114: 'F3', 115: 'F4', 116: 'F5', 117: 'F6',
    118: 'F7', 119: 'F8', 120: 'F9', 121: 'F10', 122: 'F11', 123: 'F12',
    160: '左Shift', 161: '右Shift', 162: '左Ctrl', 163: '右Ctrl', 164: '左Alt', 165: '右Alt'
};

function getVkName(vk) {
    return VK_MAP[vk] || ('VK_' + vk);
}

function renderMacroList() {
    macroListDiv.innerHTML = '';
    macros.forEach((m, idx) => {
        const div = document.createElement('div');
        div.className = 'macro-item';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.padding = '8px';
        div.style.borderBottom = '1px solid #eee';
        div.style.cursor = 'pointer';
        div.style.transition = 'background 0.2s';
        
        if (idx === currentMacroIndex) {
            div.style.backgroundColor = '#e3f2fd';
            div.style.borderLeft = '4px solid #2196F3';
        } else {
            div.style.borderLeft = '4px solid transparent';
        }
        
        div.onmouseover = () => { if(idx !== currentMacroIndex) div.style.backgroundColor = '#f5f5f5'; };
        div.onmouseout = () => { if(idx !== currentMacroIndex) div.style.backgroundColor = ''; };

        const info = document.createElement('div');
        info.style.display = 'flex';
        info.style.flexDirection = 'column';
        
        const nameSpan = document.createElement('span');
        nameSpan.style.fontWeight = 'bold';
        nameSpan.textContent = m.name;
        
        const detailSpan = document.createElement('span');
        detailSpan.style.fontSize = '12px';
        detailSpan.style.color = '#666';
        detailSpan.textContent = `触发: ${getVkName(m.triggerKey)} | 模式: ${TRIGGER_MODES[m.mode]}`;
        
        info.appendChild(nameSpan);
        info.appendChild(detailSpan);
        
        div.onclick = () => selectMacro(idx);
        
        div.appendChild(info);
        macroListDiv.appendChild(div);
    });
}

function selectMacro(index) {
    currentMacroIndex = index;
    renderMacroList();
    
    if (index >= 0 && index < macros.length) {
        const m = macros[index];
        macroEditor.style.display = 'block';
        macroNameInput.value = m.name;
        macroTriggerKeyInput.value = m.triggerKey;
        // Update Trigger Key Label if possible, maybe add a label next to input
        
        macroModeSelect.innerHTML = ''; // Clear options
        Object.entries(TRIGGER_MODES).forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            macroModeSelect.appendChild(opt);
        });
        macroModeSelect.value = m.mode;
        
        renderMacroActions();
        updateActionParamsUI(); // Init params UI
    } else {
        macroEditor.style.display = 'none';
    }
}

function renderMacroActions() {
    if (currentMacroIndex < 0) return;
    const actions = macros[currentMacroIndex].actions;
    macroActionListDiv.innerHTML = '';
    
    actions.forEach((act, idx) => {
        const div = document.createElement('div');
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '8px';
        div.style.padding = '4px 8px';
        div.style.fontSize = '13px';
        div.style.borderBottom = '1px dashed #eee';
        div.style.backgroundColor = idx % 2 === 0 ? '#fff' : '#fafafa';

        // Index
        const idxSpan = document.createElement('span');
        idxSpan.style.color = '#999';
        idxSpan.style.width = '20px';
        idxSpan.textContent = (idx + 1) + '.';

        // Type Label
        const typeLabel = document.createElement('span');
        typeLabel.style.fontWeight = 'bold';
        typeLabel.style.color = '#1976D2';
        typeLabel.style.width = '80px';
        typeLabel.textContent = ACTION_TYPES[act.type] || '未知';
        
        // Value Inputs based on type
        const valInput = document.createElement('span');
        valInput.style.flex = '1';
        valInput.style.color = '#333';
        valInput.textContent = getActionDesc(act);
        
        // Up Btn
        const upBtn = document.createElement('button');
        upBtn.textContent = '↑';
        upBtn.className = 'small-btn';
        upBtn.style.padding = '0 6px';
        upBtn.style.marginRight = '2px';
        if (idx === 0) upBtn.disabled = true;
        upBtn.onclick = (e) => {
            e.stopPropagation();
            if (idx > 0) {
                const actions = macros[currentMacroIndex].actions;
                [actions[idx - 1], actions[idx]] = [actions[idx], actions[idx - 1]];
                renderMacroActions();
            }
        };

        // Down Btn
        const downBtn = document.createElement('button');
        downBtn.textContent = '↓';
        downBtn.className = 'small-btn';
        downBtn.style.padding = '0 6px';
        downBtn.style.marginRight = '5px';
        if (idx === actions.length - 1) downBtn.disabled = true;
        downBtn.onclick = (e) => {
            e.stopPropagation();
            if (idx < actions.length - 1) {
                const actions = macros[currentMacroIndex].actions;
                [actions[idx + 1], actions[idx]] = [actions[idx], actions[idx + 1]];
                renderMacroActions();
            }
        };

        // Delete Btn
        const delBtn = document.createElement('button');
        delBtn.textContent = '×';
        delBtn.className = 'small-btn danger';
        delBtn.style.padding = '0 6px';
        delBtn.title = '删除此动作';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            macros[currentMacroIndex].actions.splice(idx, 1);
            renderMacroActions();
        };

        div.appendChild(idxSpan);
        div.appendChild(typeLabel);
        div.appendChild(valInput);
        div.appendChild(upBtn);
        div.appendChild(downBtn);
        div.appendChild(delBtn);
        macroActionListDiv.appendChild(div);
    });
}

function getActionDesc(act) {
    const t = parseInt(act.type);
    if (t === 0) {
        return `时长: ${act.val1}ms` + (act.val2 > act.val1 ? ` (随机至 ${act.val2}ms)` : '');
    } else if (t === 1 || t === 2 || t === 3) {
        let desc = `键: ${getVkName(act.val1)}`;
        if (t === 3) desc += ` (保持 ${act.val2}ms)`;
        return desc;
    } else if (t === 4) {
        return `X: ${act.val1}, Y: ${act.val2}`;
    } else if (t === 5 || t === 6 || t === 7) {
        let desc = MOUSE_BUTTONS[act.val1] || `Btn ${act.val1}`;
        if (t === 7) desc += ` (保持 ${act.val2}ms)`;
        return desc;
    } else if (t === 8) {
        return `数值: ${act.val1} (正=上, 负=下)`;
    } else if (t === 9 || t === 11) { // TouchDown, Click
        return `(${act.val1.toFixed(3)}, ${act.val2.toFixed(3)})`;
    } else if (t === 10) { // TouchUp
        return `(抬起所有)`;
    } else if (t === 12) { // Swipe
        return `(${act.val1.toFixed(2)},${act.val2.toFixed(2)}) -> (${act.val3.toFixed(2)},${act.val4.toFixed(2)})`;
    } else if (t === 13) {
        return act.val1 > 0.5 ? "开启FPS模式" : "关闭FPS模式";
    } else if (t === 14) {
        return act.val1 > 0.5 ? "显示遮罩" : "隐藏遮罩";
    }
    return `${act.val1}, ${act.val2}`;
}

// Update Action Params UI based on selected type
const actionParamsDiv = document.getElementById('actionParams');
// const newActionTypeSelect = document.getElementById('newActionType'); // Already declared in app.js

// Localize Action Type Select
(function localizeActionTypeSelect() {
    newActionTypeSelect.innerHTML = '';
    Object.entries(ACTION_TYPES).forEach(([val, label]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = label;
        newActionTypeSelect.appendChild(opt);
    });
})();

newActionTypeSelect.addEventListener('change', updateActionParamsUI);

function updateActionParamsUI() {
    actionParamsDiv.innerHTML = '';
    const type = parseInt(newActionTypeSelect.value);
    
    const createRow = (label, input) => {
        const row = document.createElement('div');
        row.className = 'param-row';
        row.style.marginTop = '5px';
        const lbl = document.createElement('label');
        lbl.textContent = label + ':';
        lbl.style.width = '70px';
        row.appendChild(lbl);
        row.appendChild(input);
        return row;
    };

    const createInput = (id, placeholder, defVal = '0', type='number') => {
        const inp = document.createElement('input');
        inp.id = id;
        inp.type = type;
        inp.className = 'small-input';
        inp.placeholder = placeholder;
        inp.value = defVal;
        if(type === 'number') inp.step = "0.001"; // Allow float
        return inp;
    };

    // Helper to add "Pick from Canvas" button
    const addPickBtn = (targetXId, targetYId) => {
        const btn = document.createElement('button');
        btn.className = 'small-btn';
        btn.textContent = '从画布拾取';
        btn.style.marginLeft = '5px';
        // Show on canvas when picking
        btn.onclick = () => {
            btn.textContent = '请点击画布...';
            btn.style.background = '#ffeb3b';
            
            const canvas = document.getElementById('canvas');
            const ctx = canvas.getContext('2d');
            
            // Draw crosshair helper
            const drawHelper = (mx, my) => {
                // Redraw canvas (assuming app.js redraws loop, but we might need to force it or overlay)
                // For simplicity, we just draw on top. Ideally we should hook into app.js render loop.
                // But since app.js uses requestAnimationFrame, drawing here might flicker.
                // Let's just rely on cursor change for now, or add a DOM element overlay.
                canvas.style.cursor = 'crosshair';
            };
            drawHelper();

            const handler = (e) => {
                const rect = canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                
                const nx = x / canvas.width;
                const ny = y / canvas.height;
                
                document.getElementById(targetXId).value = nx.toFixed(4);
                document.getElementById(targetYId).value = ny.toFixed(4);
                
                btn.textContent = '已拾取';
                btn.style.background = '';
                canvas.style.cursor = 'default';
                
                // Visual feedback: Draw a temporary marker
                const marker = document.createElement('div');
                marker.style.position = 'absolute';
                marker.style.left = (e.clientX - 5) + 'px';
                marker.style.top = (e.clientY - 5) + 'px';
                marker.style.width = '10px';
                marker.style.height = '10px';
                marker.style.border = '2px solid red';
                marker.style.borderRadius = '50%';
                marker.style.pointerEvents = 'none';
                marker.style.zIndex = '9999';
                document.body.appendChild(marker);
                
                setTimeout(() => {
                    btn.textContent = '从画布拾取';
                    if(marker.parentNode) marker.parentNode.removeChild(marker);
                }, 1000);
                
                canvas.removeEventListener('click', handler);
            };
            
            canvas.addEventListener('click', handler);
        };
        return btn;
    };

    if (type === 0) { // Delay
        actionParamsDiv.appendChild(createRow('时长(ms)', createInput('actVal1', '100', '100')));
        actionParamsDiv.appendChild(createRow('最大随机(ms)', createInput('actVal2', '0 (固定)', '0')));
        
    } else if (type === 1 || type === 2 || type === 3) { // Key
        const row = document.createElement('div');
        row.className = 'param-row';
        row.style.marginTop = '5px';
        
        const lbl = document.createElement('label');
        lbl.textContent = '按键:';
        lbl.style.width = '70px';
        
        const inp = createInput('actVal1', 'VK Code');
        inp.style.width = '60px';
        
        const btn = document.createElement('button');
        btn.className = 'small-btn';
        btn.textContent = '捕获按键';
        btn.onclick = () => {
            btn.textContent = '请按键...';
            btn.style.background = '#ffeb3b';
            listenForKey((name, code) => {
                inp.value = code;
                btn.textContent = `已捕获: ${getVkName(code)}`;
                btn.style.background = '';
                setTimeout(() => btn.textContent = '捕获按键', 2000);
            });
        };
        
        row.appendChild(lbl);
        row.appendChild(inp);
        row.appendChild(btn);
        actionParamsDiv.appendChild(row);

        if (type === 3) { // KeyPress needs duration
            actionParamsDiv.appendChild(createRow('保持(ms)', createInput('actVal2', '20', '20')));
        }
        
    } else if (type === 4) { // Move
        actionParamsDiv.appendChild(createRow('X 偏移', createInput('actVal1', '0')));
        actionParamsDiv.appendChild(createRow('Y 偏移', createInput('actVal2', '0')));
        
    } else if (type === 5 || type === 6 || type === 7) { // Mouse Btn
        const sel = document.createElement('select');
        sel.id = 'actVal1';
        sel.className = 'small-select';
        Object.entries(MOUSE_BUTTONS).forEach(([val, label]) => {
            const opt = document.createElement('option');
            opt.value = val;
            opt.textContent = label;
            sel.appendChild(opt);
        });
        actionParamsDiv.appendChild(createRow('按键', sel));
        
        if (type === 7) {
            actionParamsDiv.appendChild(createRow('保持(ms)', createInput('actVal2', '20', '20')));
        }
        
    } else if (type === 8) { // Scroll
        const inp = createInput('actVal1', '120', '120');
        inp.title = '正数向上滚动，负数向下滚动，通常为 120 的倍数';
        actionParamsDiv.appendChild(createRow('滚动值', inp));
    } else if (type === 9 || type === 11) { // TouchDown, Click
        const r1 = createRow('X 坐标', createInput('actVal1', '0.5'));
        r1.appendChild(addPickBtn('actVal1', 'actVal2'));
        actionParamsDiv.appendChild(r1);
        actionParamsDiv.appendChild(createRow('Y 坐标', createInput('actVal2', '0.5')));
        if (type === 11) {
             actionParamsDiv.appendChild(createRow('保持(ms)', createInput('actVal3', '50', '50')));
        }
    } else if (type === 10) { // TouchUp
        // No params needed usually, maybe ID? For now global up
        const info = document.createElement('div');
        info.innerText = '释放所有由宏触发的触摸点';
        info.style.fontSize = '12px';
        info.style.color = '#666';
        actionParamsDiv.appendChild(info);
    } else if (type === 12) { // Swipe
        const r1 = createRow('起点 X', createInput('actVal1', '0.5'));
        r1.appendChild(addPickBtn('actVal1', 'actVal2'));
        actionParamsDiv.appendChild(r1);
        actionParamsDiv.appendChild(createRow('起点 Y', createInput('actVal2', '0.5')));
        
        const r2 = createRow('终点 X', createInput('actVal3', '0.5'));
        r2.appendChild(addPickBtn('actVal3', 'actVal4'));
        actionParamsDiv.appendChild(r2);
        actionParamsDiv.appendChild(createRow('终点 Y', createInput('actVal4', '0.5')));
    } else if (type === 13) { // Set FPS Mode
        const sel = document.createElement('select');
        sel.id = 'actVal1';
        sel.className = 'small-select';
        const opt1 = document.createElement('option'); opt1.value = 1; opt1.textContent = '开启FPS模式 (隐藏鼠标)';
        const opt0 = document.createElement('option'); opt0.value = 0; opt0.textContent = '关闭FPS模式 (显示鼠标)';
        sel.appendChild(opt1);
        sel.appendChild(opt0);
        actionParamsDiv.appendChild(createRow('状态', sel));
        
    } else if (type === 14) { // Set Overlay
        const sel = document.createElement('select');
        sel.id = 'actVal1';
        sel.className = 'small-select';
        const opt1 = document.createElement('option'); opt1.value = 1; opt1.textContent = '显示遮罩层';
        const opt0 = document.createElement('option'); opt0.value = 0; opt0.textContent = '隐藏遮罩层';
        sel.appendChild(opt1);
        sel.appendChild(opt0);
        actionParamsDiv.appendChild(createRow('状态', sel));
    }
}

// Add Action Handler
btnAddAction.addEventListener('click', () => {
    if (currentMacroIndex < 0) return;
    const type = parseInt(newActionTypeSelect.value);
    
    const getVal = (id) => {
        const el = document.getElementById(id);
        if (!el) return 0;
        // For Touch actions (9, 11, 12), keep as float
        if ([9, 11, 12].includes(type)) return parseFloat(el.value || 0);
        return parseFloat(el.value || 0); // Always float now supported by C++
    };

    const val1 = getVal('actVal1');
    const val2 = getVal('actVal2');
    const val3 = getVal('actVal3'); 
    const val4 = getVal('actVal4');

    macros[currentMacroIndex].actions.push({
        type: type,
        val1: val1,
        val2: val2,
        val3: val3,
        val4: val4
    });
    renderMacroActions();
});

// Other Handlers
btnAddMacro.addEventListener('click', () => {
    macros.push({
        name: '新建宏 ' + (macros.length + 1),
        triggerKey: 0,
        mode: 0,
        actions: []
    });
    selectMacro(macros.length - 1);
});

btnDeleteMacro.addEventListener('click', () => {
    if (currentMacroIndex >= 0) {
        if(confirm('确定要删除这个宏吗？')) {
            macros.splice(currentMacroIndex, 1);
            currentMacroIndex = -1;
            renderMacroList();
            macroEditor.style.display = 'none';
        }
    }
});

btnSaveMacro.addEventListener('click', () => {
    if (currentMacroIndex >= 0) {
        const m = macros[currentMacroIndex];
        m.name = macroNameInput.value;
        m.triggerKey = parseInt(macroTriggerKeyInput.value || 0);
        m.mode = parseInt(macroModeSelect.value);
        renderMacroList();
        setStatus('宏已更新，请点击【保存配置】以写入文件', '#1976D2', 3000);
    }
});

btnGetMacroKey.addEventListener('click', () => {
    const btn = btnGetMacroKey;
    const originalText = btn.textContent;
    btn.textContent = '请按键...';
    btn.style.background = '#ffeb3b';
    
    listenForKey((keyName, code) => {
        macroTriggerKeyInput.value = code;
        setStatus(`已捕获: ${getVkName(code)} (${code})`, '#4caf50', 2000);
        btn.textContent = originalText;
        btn.style.background = '';
    });
});
