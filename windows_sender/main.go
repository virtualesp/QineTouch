package main

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"

	"go.bug.st/serial"
	"golang.org/x/sys/windows"
)

// WinAPI 常量和类型
const (
	WS_EX_TOPMOST       = 0x00000008
	WS_EX_LAYERED       = 0x00080000
	WS_EX_TRANSPARENT   = 0x00000020 // 鼠标穿透（如果需要拦截点击，不要加这个）
	WS_EX_TOOLWINDOW    = 0x00000080
	WS_POPUP            = 0x80000000
	WS_VISIBLE          = 0x10000000
	WS_BORDER           = 0x00800000
	WS_CAPTION          = 0x00C00000
	WS_SYSMENU          = 0x00080000
	WS_THICKFRAME       = 0x00040000
	WS_MINIMIZEBOX      = 0x00020000
	WS_MAXIMIZEBOX      = 0x00010000
	WS_OVERLAPPED       = 0x00000000
	WS_OVERLAPPEDWINDOW = WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_THICKFRAME | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
	LWA_ALPHA           = 0x00000002
	LWA_COLORKEY        = 0x00000001
	SW_HIDE             = 0
	SW_SHOW             = 5
	WH_MOUSE_LL         = 14
	WM_MOUSEWHEEL       = 0x020A
	WM_LBUTTONDOWN      = 0x0201
	HTCAPTION           = 2
	WM_NCLBUTTONDOWN    = 0x00A1
)

var (
	user32                         = windows.NewLazySystemDLL("user32.dll")
	procGetCursorPos               = user32.NewProc("GetCursorPos")
	procGetSystemMetrics           = user32.NewProc("GetSystemMetrics")
	procGetAsyncKeyState           = user32.NewProc("GetAsyncKeyState")
	procCreateWindowEx             = user32.NewProc("CreateWindowExW")
	procRegisterClassEx            = user32.NewProc("RegisterClassExW")
	procDefWindowProc              = user32.NewProc("DefWindowProcW")
	procShowWindow                 = user32.NewProc("ShowWindow")
	procUpdateWindow               = user32.NewProc("UpdateWindow")
	procGetMessage                 = user32.NewProc("GetMessageW")
	procTranslateMessage           = user32.NewProc("TranslateMessage")
	procDispatchMessage            = user32.NewProc("DispatchMessageW")
	procLoadCursor                 = user32.NewProc("LoadCursorW")
	procSetLayeredWindowAttributes = user32.NewProc("SetLayeredWindowAttributes")
	procSetCursorPos               = user32.NewProc("SetCursorPos")
	procShowCursor                 = user32.NewProc("ShowCursor")
	procClipCursor                 = user32.NewProc("ClipCursor")
	procSetWindowsHookEx           = user32.NewProc("SetWindowsHookExW")
	procCallNextHookEx             = user32.NewProc("CallNextHookEx")
	procUnhookWindowsHookEx        = user32.NewProc("UnhookWindowsHookEx")
	procCreateSolidBrush           = gdi32.NewProc("CreateSolidBrush")
	procDeleteObject               = gdi32.NewProc("DeleteObject")
	procSendMessage                = user32.NewProc("SendMessageW")
	procPostMessage                = user32.NewProc("PostMessageW")
	procSetWindowPos               = user32.NewProc("SetWindowPos")
	procReleaseCapture             = user32.NewProc("ReleaseCapture")
)

// 窗口消息处理回调函数
func wndProc(hwnd windows.Handle, msg uint32, wParam, lParam uintptr) uintptr {
	// 实现无标题栏拖动
	// 修正：增加 ReleaseCapture 防止卡死；增加 Ctrl 键判断防止误触
	if msg == WM_LBUTTONDOWN {
		// 1. 检查是否按住了 CTRL 键。只有按住 CTRL 才允许拖动，否则视为正常点击（被遮罩拦截）
		if getAsyncKeyState(VK_CONTROL) {
			overlayRectMutex.RLock()
			// 只有在配置了参考分辨率（窗口模式）时才允许拖动
			if globalCfg != nil && globalCfg.ReferenceWidth > 0 {
				overlayRectMutex.RUnlock()

				procReleaseCapture.Call()

				procSendMessage.Call(uintptr(hwnd), WM_NCLBUTTONDOWN, HTCAPTION, 0)
				return 0
			}
			overlayRectMutex.RUnlock()
		}
	}

	// 处理窗口移动后的位置更新
	if msg == 0x0003 { // WM_MOVE
		x := int32(lParam & 0xFFFF)
		y := int32((lParam >> 16) & 0xFFFF)

		overlayRectMutex.Lock()
		overlayRect.X = int(x)
		overlayRect.Y = int(y)
		// W 和 H 不变
		overlayRectMutex.Unlock()

		// 拖动后更新光标限制区域
		updateCursorClip(overlayEnabled)
	}

	r, _, _ := procDefWindowProc.Call(uintptr(hwnd), uintptr(msg), wParam, lParam)
	return r
}

type MSLLHOOKSTRUCT struct {
	Pt          struct{ X, Y int32 }
	MouseData   uint32
	Flags       uint32
	Time        uint32
	DwExtraInfo uintptr
}

var (
	hMouseHook     uintptr
	globalCfg      *Config
	globalCfgMutex sync.RWMutex // Protect globalCfg update
	globalPort     serial.Port
)

var gdi32 = windows.NewLazySystemDLL("gdi32.dll")

// Overlay
var (
	overlayHwnd      uintptr
	overlayEnabled   bool = true
	overlayRect      struct{ X, Y, W, H int }
	overlayRectMutex sync.RWMutex
)

// 设置鼠标光标位置
func setCursorPos(x, y int) {
	procSetCursorPos.Call(uintptr(x), uintptr(y))
}

// 显示或隐藏光标
// visible: true=显示, false=隐藏
func showCursor(visible bool) {
	v := 0
	if visible {
		v = 1
	}
	procShowCursor.Call(uintptr(v))
}

type RECT struct {
	Left, Top, Right, Bottom int32
}

// 更新光标限制区域
func updateCursorClip(enable bool) {
	if !enable {
		procClipCursor.Call(0) // 释放光标限制
		return
	}

	overlayRectMutex.RLock()
	x, y, w, h := overlayRect.X, overlayRect.Y, overlayRect.W, overlayRect.H
	overlayRectMutex.RUnlock()

	if w == 0 || h == 0 {
		return
	}

	r := RECT{
		Left:   int32(x),
		Top:    int32(y),
		Right:  int32(x + w),
		Bottom: int32(y + h),
	}
	procClipCursor.Call(uintptr(unsafe.Pointer(&r)))
}

// 执行边界诊断测试
func runDiagnosticTest(port serial.Port, cfg *Config) {
	log.Println("=== 开始边界诊断测试 ===")
	log.Println("请在手机上打开 [开发者选项] -> [指针位置]，观察触点是否准确")

	points := []struct {
		name string
		x, y float64 // 0.0 - 1.0
	}{
		{"左上角 (0, 0)", 0, 0},
		{"右上角 (1, 0)", 1.0, 0},
		{"右下角 (1, 1)", 1.0, 1.0},
		{"左下角 (0, 1)", 0, 1.0},
		{"中心点 (0.5, 0.5)", 0.5, 0.5},
	}

	for _, p := range points {
		log.Printf("[TEST] 点击 %s -> (%.2f, %.2f)", p.name, p.x, p.y)
		tapAt(port, 9, p.x, p.y, cfg)
		time.Sleep(1500 * time.Millisecond)
	}

	log.Println("=== 诊断测试结束 ===")
}

// 创建一个全屏或指定大小的透明窗口来捕获鼠标点击，防止误触桌面
func createOverlayWindow(cfg *Config) {
	// 启动一个专用的 OS 线程来处理窗口创建和消息循环
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()

		// 注册窗口类
		className := windows.StringToUTF16Ptr("QInETouchOverlay")
		hInst := windows.Handle(0)

		// RGB(0,0,0) = 0
		hBrush, _, _ := procCreateSolidBrush.Call(0)

		wndClass := struct {
			CbSize        uint32
			Style         uint32
			LpfnWndProc   uintptr
			CbClsExtra    int32
			CbWndExtra    int32
			HInstance     windows.Handle
			HIcon         windows.Handle
			HCursor       windows.Handle
			HbrBackground windows.Handle
			LpszMenuName  *uint16
			LpszClassName *uint16
			HIconSm       windows.Handle
		}{
			CbSize:        80, // sizeof(WNDCLASSEX)
			LpfnWndProc:   syscall.NewCallback(wndProc),
			HInstance:     hInst,
			LpszClassName: className,
			HbrBackground: windows.Handle(hBrush), // Black background
		}
		// 加载默认箭头光标
		cursor, _, _ := procLoadCursor.Call(0, 32512) // IDC_ARROW
		wndClass.HCursor = windows.Handle(cursor)

		procRegisterClassEx.Call(uintptr(unsafe.Pointer(&wndClass)))

		// 获取屏幕尺寸
		sw := getSystemMetrics(0)
		sh := getSystemMetrics(1)

		// 确定窗口尺寸和位置
		var x, y, w, h int
		if cfg.ReferenceWidth > 0 && cfg.ReferenceHeight > 0 {
			scale := cfg.OverlayScale
			if scale <= 0 || scale > 2.0 {
				scale = 1.0
			}

			w = int(float64(cfg.ReferenceWidth) * scale)
			h = int(float64(cfg.ReferenceHeight) * scale)
			// Center the window
			x = (sw - w) / 2
			y = (sh - h) / 2
			log.Printf("[UI] 使用参考分辨率创建遮罩: %dx%d (原始: %dx%d, 缩放: %.2f) (位置: %d,%d)", w, h, cfg.ReferenceWidth, cfg.ReferenceHeight, scale, x, y)
		} else {
			w = sw
			h = sh
			x = 0
			y = 0
			log.Printf("[UI] 使用全屏模式创建遮罩: %dx%d", w, h)
		}

		// 更新全局矩形区域
		overlayRectMutex.Lock()
		overlayRect.X = x
		overlayRect.Y = y
		overlayRect.W = w
		overlayRect.H = h
		overlayRectMutex.Unlock()

		// 创建窗口
		// WS_EX_TOPMOST: 置顶
		// WS_EX_LAYERED: 用于透明度
		// WS_EX_TOOLWINDOW: 不在任务栏显示
		// WS_POPUP | WS_BORDER: 无标题栏但有边框
		style := uintptr(WS_POPUP | WS_VISIBLE)
		if cfg.ReferenceWidth > 0 {
			style |= WS_BORDER // 非全屏时添加边框（全屏时也可加？）
		}

		hwnd, _, _ := procCreateWindowEx.Call(
			WS_EX_TOPMOST|WS_EX_LAYERED|WS_EX_TOOLWINDOW,
			uintptr(unsafe.Pointer(className)),
			uintptr(unsafe.Pointer(className)),
			style,
			uintptr(x), uintptr(y), uintptr(w), uintptr(h),
			0, 0, 0, 0,
		)

		if hwnd == 0 {
			log.Println("[WARN] 创建遮罩窗口失败，鼠标点击可能会穿透到桌面")
			return
		}

		overlayHwnd = hwnd

		// 设置透明度 (LWA_ALPHA)
		procSetLayeredWindowAttributes.Call(hwnd, 0, 30, LWA_ALPHA)

		procShowWindow.Call(hwnd, SW_SHOW)
		procUpdateWindow.Call(hwnd)

		// 安装鼠标钩子
		installMouseHook()

		// 初始应用光标限制
		overlayRectMutex.RLock()
		if overlayEnabled {
			updateCursorClip(true)
		}
		overlayRectMutex.RUnlock()

		log.Println("[UI] 防误触遮罩已启动")

		// 消息循环
		var msg struct {
			Hwnd    windows.Handle
			Message uint32
			WParam  uintptr
			LParam  uintptr
			Time    uint32
			Pt      struct{ X, Y int32 }
		}
		for {
			ret, _, _ := procGetMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
			if ret == 0 {
				break
			}
			procTranslateMessage.Call(uintptr(unsafe.Pointer(&msg)))
			procDispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
		}
	}()
}

// 安装全局鼠标钩子
func installMouseHook() {
	callback := syscall.NewCallback(mouseHookProc)
	hHook, _, err := procSetWindowsHookEx.Call(
		WH_MOUSE_LL,
		callback,
		0,
		0,
	)
	if hHook == 0 {
		log.Printf("[WARN] 安装鼠标钩子失败: %v", err)
		return
	}
	hMouseHook = hHook
	log.Println("[HOOK] 全局鼠标钩子已安装 (支持滚轮)")
}

var (
	scrollMutex   sync.Mutex
	isScrolling   bool
	scrollTouchID uint8 = 10 // 专用ID
)

// 鼠标钩子回调
func mouseHookProc(nCode int, wParam uintptr, lParam uintptr) uintptr {
	if nCode >= 0 && wParam == WM_MOUSEWHEEL {
		// 解析滚轮事件
		hookStruct := (*MSLLHOOKSTRUCT)(unsafe.Pointer(lParam))
		// High word of MouseData is delta
		delta := int16(hookStruct.MouseData >> 16)

		// 检查配置
		var action *ScrollActionConfig
		if globalCfg != nil {
			if delta > 0 {
				action = globalCfg.ScrollUp
			} else {
				action = globalCfg.ScrollDown
			}
		}

		if action != nil {
			if action.Mode == "tap" {
				go func(a *ScrollActionConfig) {
					if debugMode {
						log.Printf("[SCROLL] 触发点击 (%.2f, %.2f)", a.X, a.Y)
					}
					tapAt(globalPort, scrollTouchID, a.X, a.Y, globalCfg)
				}(action)
			} else if action.Mode == "swipe" {
				// 防抖/互斥
				scrollMutex.Lock()
				if isScrolling {
					scrollMutex.Unlock()
					return 0
				}
				isScrolling = true
				scrollMutex.Unlock()

				go func(a *ScrollActionConfig) {
					defer func() {
						scrollMutex.Lock()
						isScrolling = false
						scrollMutex.Unlock()
					}()

					if debugMode {
						log.Printf("[SCROLL] 触发滑动 (%.2f, %.2f) -> (%.2f, %.2f)", a.StartX, a.StartY, a.EndX, a.EndY)
					}

					duration := a.Duration
					if duration <= 0 {
						duration = 200
					}

					// Down
					_ = sendTouchFromNormalized(globalPort, ActionDown, scrollTouchID, a.StartX, a.StartY, globalCfg)

					// 插值移动
					steps := duration / 10 // every 10ms
					if steps < 1 {
						steps = 1
					}
					for i := 1; i <= steps; i++ {
						t := float64(i) / float64(steps)
						currX := a.StartX + (a.EndX-a.StartX)*t
						currY := a.StartY + (a.EndY-a.StartY)*t
						_ = sendTouchFromNormalized(globalPort, ActionMove, scrollTouchID, currX, currY, globalCfg)
						time.Sleep(10 * time.Millisecond)
					}

					// Up
					_ = sendTouch(globalPort, ActionUp, scrollTouchID, 0, 0)

				}(action)
			}
		}
	}

	r, _, _ := procCallNextHookEx.Call(hMouseHook, uintptr(nCode), wParam, lParam)
	return r
}

// 定义滚轮事件配置
type ScrollActionConfig struct {
	Mode     string  `json:"mode"` // "tap" or "swipe"
	X        float64 `json:"x,omitempty"`
	Y        float64 `json:"y,omitempty"`
	StartX   float64 `json:"startX,omitempty"`
	StartY   float64 `json:"startY,omitempty"`
	EndX     float64 `json:"endX,omitempty"`
	EndY     float64 `json:"endY,omitempty"`
	Duration int     `json:"duration,omitempty"` // 滑动持续时间 ms
}

// Config 用于定义目标设备分辨率、串口以及快捷键映射
type Config struct {
	Port          string               `json:"port"`
	Rotation      int                  `json:"rotation"`
	KeyMap        map[string]KeyConfig `json:"keyMap"`
	ToggleKey     string               `json:"toggleKey"`
	SendInterval  int                  `json:"sendIntervalMs"`
	PollingRate   int                  `json:"pollingRate,omitempty"` // 轮询率 Hz, 覆盖 sendIntervalMs
	MovementWheel *MovementWheel       `json:"movementWheel,omitempty"`
	MouseWheels   []MouseWheelConfig   `json:"mouseWheels,omitempty"`
	ViewArea      *ViewArea            `json:"viewArea,omitempty"`
	AntiCheat     *AntiCheatConfig     `json:"antiCheat,omitempty"`
	ScrollUp      *ScrollActionConfig  `json:"scrollUp,omitempty"`
	ScrollDown    *ScrollActionConfig  `json:"scrollDown,omitempty"`

	// 使用参数列表中的分辨率来设置遮罩层
	ReferenceWidth  int     `json:"uiReferenceWidth"`
	ReferenceHeight int     `json:"uiReferenceHeight"`
	OverlayScale    float64 `json:"overlayScale"` // 0.1 - 1.0 (default 1.0)
	OverlayKey      string  `json:"overlayKey"`   // e.g. "F8"

	// 兼容旧配置的临时字段 (不导出到 JSON)
	LegacyTargetWidth  int `json:"targetWidth,omitempty"`
	LegacyTargetHeight int `json:"targetHeight,omitempty"`

	License string `json:"license,omitempty"` // 激活码
}

// 鼠标轮盘组件配置
type MouseWheelConfig struct {
	Key         string  `json:"key"`
	X           float64 `json:"x"` // 0.0 - 1.0
	Y           float64 `json:"y"` // 0.0 - 1.0
	Radius      float64 `json:"radius,omitempty"`
	TriggerTime int     `json:"triggerTime,omitempty"` // 长按触发阈值(ms)，0表示立即触发
}

// 防检测配置 (全部使用 0.0-1.0 的屏幕比例)
type AntiCheatConfig struct {
	RandomOffsetRange float64 `json:"randomOffsetRange"` // 按下时的随机偏移半径 (比例, e.g. 0.005)
	MicroMoveRange    float64 `json:"microMoveRange"`    // 长按微动范围 (比例, e.g. 0.01)
	MicroMoveSpeed    float64 `json:"microMoveSpeed"`    // 微动速度 (控制正弦波频率)
	MicroMoveDelay    int     `json:"microMoveDelayMs"`  // 按下多久后开始微动 (毫秒)

	DriftHoldTimeMin int `json:"driftHoldTimeMin,omitempty"` // 最小静止时间 (ms)
	DriftHoldTimeMax int `json:"driftHoldTimeMax,omitempty"` // 最大静止时间 (ms)
	DriftDurationMin int `json:"driftDurationMin,omitempty"` // 最小漂移时间 (ms)
	DriftDurationMax int `json:"driftDurationMax,omitempty"` // 最大漂移时间 (ms)
}

// 按键配置，包含坐标和独立的触发半径
type KeyConfig struct {
	X      float64 `json:"x"` // 0.0 - 1.0
	Y      float64 `json:"y"` // 0.0 - 1.0
	Radius float64 `json:"radius,omitempty"`
}

// Pt 表示坐标点
type Pt struct {
	X float64 `json:"x"` // 0.0 - 1.0
	Y float64 `json:"y"` // 0.0 - 1.0
}

// WASD轮盘配置
type MovementWheel struct {
	Center      Pt      `json:"center"`
	Radius      float64 `json:"radius"`
	WalkRadius  float64 `json:"walkRadius,omitempty"`  // 走路半径
	ModifierKey string  `json:"modifierKey,omitempty"` // 切换键 (如 Shift 或 Ctrl)
	Stiffness   float64 `json:"stiffness"`             // 弹簧刚度 (默认 0.015)
	Damping     float64 `json:"damping"`               // 阻尼系数 (默认 0.25)
}

// 视角滑动区域配置
type ViewArea struct {
	Center          Pt      `json:"center"`
	Width           float64 `json:"width,omitempty"`  // 0.0 - 1.0
	Height          float64 `json:"height,omitempty"` // 0.0 - 1.0
	Anchored        bool    `json:"anchored"`
	Button          string  `json:"button"` // LMB / RMB
	Sensitivity     float64 `json:"sensitivity"`
	Acceleration    float64 `json:"acceleration,omitempty"`      // 0.0 - 1.0 (or higher)
	AutoReleaseTime int     `json:"autoReleaseTimeMs,omitempty"` // 自动抬起时间(ms)，0表示不启用
}

// VK 虚拟按键常量
const (
	VK_LBUTTON  = 0x01
	VK_RBUTTON  = 0x02
	VK_SPACE    = 0x20
	VK_SHIFT    = 0x10
	VK_CONTROL  = 0x11
	VK_MENU     = 0x12
	VK_LMENU    = 0xA4
	VK_RMENU    = 0xA5
	VK_W        = 0x57
	VK_A        = 0x41
	VK_S        = 0x53
	VK_D        = 0x44
	VK_XBUTTON1 = 0x05
	VK_XBUTTON2 = 0x06
)

// HID 协议常量
const (
	HIDHeader   = 0xF4
	ActionDown  = 0x03
	ActionUp    = 0x00
	ActionMove  = 0x01
	HIDMaxCoord = 32767
	BaudRate    = 921600
)

var (
	debugMode = true
	// 串口发送队列
	serialSendCh = make(chan []byte, 4096)

	// 全局触摸状态跟踪
	touchLock      sync.Mutex
	activeTouchIDs = make(map[uint8]TouchPoint)

	// 鼠标轮盘状态
	activeMouseWheel  *MouseWheelConfig
	mouseWheelTouchID uint8 = 7 // 专用ID
	mouseWheelLastX   float64
	mouseWheelLastY   float64

	mouseWheelLastSentXNorm float64
	mouseWheelLastSentYNorm float64

	// 动态分辨率缓存
	lastValidScreenWidth  float64
	lastValidScreenHeight float64
)

// 记录触摸点坐标 (HID space)
type TouchPoint struct {
	X, Y uint32
}

// Windows系统的屏幕坐标点
type CursorPos struct {
	X int32
	Y int32
}

// 获取当前鼠标光标位置（屏幕坐标）
func getCursorPos() (CursorPos, error) {
	var pt struct {
		X, Y int32
	}
	r1, _, err := procGetCursorPos.Call(uintptr(unsafe.Pointer(&pt)))
	if r1 == 0 {
		return CursorPos{}, err
	}
	return CursorPos{X: pt.X, Y: pt.Y}, nil
}

// 获取系统指标（如屏幕宽高）
func getSystemMetrics(index int) int {
	r1, _, _ := procGetSystemMetrics.Call(uintptr(index))
	return int(r1)
}

// 检测虚拟按键是否处于按下状态
func getAsyncKeyState(vk int) bool {
	r1, _, _ := procGetAsyncKeyState.Call(uintptr(vk))
	return (uint16(r1) & 0x8000) != 0
}

// 通过串口发送触摸事件数据包
func sendTouch(port serial.Port, action uint8, id uint8, x, y uint32) error {
	touchLock.Lock()
	if action == ActionUp {
		delete(activeTouchIDs, id)
	} else {
		activeTouchIDs[id] = TouchPoint{X: x, Y: y}
	}
	count := uint8(len(activeTouchIDs))

	var others []struct {
		id uint8
		pt TouchPoint
	}
	if action == ActionDown || action == ActionUp {
		for oid, opt := range activeTouchIDs {
			if oid != id {
				others = append(others, struct {
					id uint8
					pt TouchPoint
				}{oid, opt})
			}
		}
	}

	var ids []int
	if debugMode && action != ActionMove {
		ids = make([]int, 0, len(activeTouchIDs))
		for k := range activeTouchIDs {
			ids = append(ids, int(k))
		}
	}
	touchLock.Unlock()

	if debugMode && action != ActionMove {
		actStr := "UP"
		if action&0x01 == 1 {
			actStr = "DOWN"
		}
		log.Printf("[SERIAL] 构造: ID=%d Action=%s X=%d Y=%d Count=%d Active=%v", id, actStr, x, y, count, ids)
	}

	sendPacket(action, id, x, y, count)

	for _, o := range others {
		if len(serialSendCh) > 10 {
			continue
		}
		sendPacket(ActionMove, o.id, o.pt.X, o.pt.Y, count)
	}
	return nil
}

// 封装底层的包构造和发送逻辑
func sendPacket(action uint8, id uint8, x, y uint32, count uint8) {
	isStandardMove := action == ActionMove
	if isStandardMove && len(serialSendCh) > 20 {
		return
	}

	buf := make([]byte, 12)
	buf[0] = HIDHeader
	buf[1] = action & 0x01
	buf[2] = id
	binary.LittleEndian.PutUint32(buf[3:7], x)
	binary.LittleEndian.PutUint32(buf[7:11], y)
	buf[11] = count

	select {
	case serialSendCh <- buf:
	default:
		if action&0x01 == ActionMove {
			if debugMode {
				log.Println("[WARN] 发送队列已满，丢弃 MOVE 事件")
			}
		} else {
			log.Println("[ERR] 发送队列已满，丢失关键事件 (DOWN/UP)！建议增大队列或降低频率")
		}
	}
}

// 负责从队列读取数据并写入串口
func serialSender(port serial.Port) {
	log.Println("[SENDER] 串口发送协程已启动")
	const BatchSize = 32
	rawBuf := make([]byte, 0, 12*BatchSize)

	for {
		pkt, ok := <-serialSendCh
		if !ok {
			return
		}
		rawBuf = append(rawBuf[:0], pkt...)

	Loop:
		for len(rawBuf) < cap(rawBuf) {
			select {
			case p := <-serialSendCh:
				rawBuf = append(rawBuf, p...)
			default:
				break Loop
			}
		}

		n, err := port.Write(rawBuf)
		if err != nil {
			log.Printf("[ERR] 串口写入失败: %v", err)
			time.Sleep(100 * time.Millisecond)
		} else {
			logSendSuccess(n)
		}
	}
}

var packetSendCounter int

func logSendSuccess(n int) {
	packetSendCounter++
	if debugMode && packetSendCounter%10 == 0 {
		log.Printf("[SENDER] 持续发送中... (累计已发送 %d 字节)", packetSendCounter*12)
	}
}

// 坐标(0.0-1.0)转换为HID坐标并发送
// 自动处理旋转逻辑
func sendTouchFromNormalized(port serial.Port, action uint8, id uint8, nx, ny float64, cfg *Config) error {
	rotation := cfg.Rotation

	// 处理旋转
	// 旋转是在归一化空间进行的
	// 0:   (x, y)
	// 90:  (1-y, x)  <-- 视觉宽变物理高
	// 180: (1-x, 1-y)
	// 270: (y, 1-x)

	rx, ry := nx, ny

	switch rotation {
	case 90:
		rx = 1.0 - ny
		ry = nx
	case 180:
		rx = 1.0 - nx
		ry = 1.0 - ny
	case 270:
		rx = ny
		ry = 1.0 - nx
	}

	// 映射到 HID 0-32767
	hx := uint32(rx * float64(HIDMaxCoord))
	hy := uint32(ry * float64(HIDMaxCoord))

	// 边界保护
	if hx > HIDMaxCoord {
		hx = HIDMaxCoord
	}
	if hy > HIDMaxCoord {
		hy = HIDMaxCoord
	}

	return sendTouch(port, action, id, hx, hy)
}

// 打开并返回串口
func openSerial(cfg *Config) (serial.Port, string, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		return nil, "", err
	}
	if len(ports) == 0 {
		return nil, "", fmt.Errorf("未发现任何串口设备")
	}
	selected := cfg.Port
	if selected == "" {
		selected = ports[len(ports)-1]
	}
	mode := &serial.Mode{
		BaudRate: BaudRate,
		DataBits: 8,
		Parity:   serial.NoParity,
		StopBits: serial.OneStopBit,
	}
	p, err := serial.Open(selected, mode)
	if err != nil {
		return nil, "", err
	}

	// 如果不设置，某些串口驱动可能会拉低 DTR/RTS 导致板子复位
	p.SetDTR(false)
	p.SetRTS(false)

	_ = p.ResetOutputBuffer()
	// 4. 读取设备返回
	go func() {
		buf := make([]byte, 1024)
		var lineBuffer string
		for {
			n, err := p.Read(buf)
			if err != nil {
				log.Printf("[SERIAL-READ] 读取错误: %v", err)
				return
			}
			if n > 0 {
				str := string(buf[:n])
				// fmt.Printf("[BOARD] %s", str) // 移除直接打印，避免乱码和刷屏

				lineBuffer += str
				for {
					idx := strings.Index(lineBuffer, "\n")
					if idx == -1 {
						break
					}
					line := lineBuffer[:idx]
					// 处理完整的一行
					line = strings.TrimSpace(line)
					if line != "" {
						// 过滤非 ASCII 字符
						cleanLine := strings.Map(func(r rune) rune {
							if r >= 32 && r <= 126 {
								return r
							}
							return -1
						}, line)
						log.Printf("[BOARD] %s", cleanLine)
						parseBoardOutput(cleanLine)
					}

					lineBuffer = lineBuffer[idx+1:]
				}

				if len(lineBuffer) > 4096 {
					lineBuffer = lineBuffer[2048:]
				}
			}
		}
	}()

	// 启动时尝试获取一次 MAC
	time.Sleep(500 * time.Millisecond)
	p.Write([]byte("GET_MAC\n"))

	// 等待并校验固件版本
	if !waitForFirmwareHandshake() {
		return nil, "", fmt.Errorf("固件版本不匹配或设备未响应，请更新固件到 v3.2")
	}

	return p, selected, nil
}

func waitForFirmwareHandshake() bool {
	// 等待握手信号 (最多 3 秒)

	start := time.Now()
	for time.Since(start) < 3*time.Second {
		deviceStatusMutex.Lock()
		ver := deviceStatus.FirmwareVer
		deviceStatusMutex.Unlock()

		if ver == "v3.1" || ver == "v3.2" {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	return false
}

// 记录设备状态，供UI读取
type DeviceStatus struct {
	Connected   bool   `json:"connected"`
	MAC         string `json:"mac"`
	Status      string `json:"status"` // "active", "auth_required", "unknown"
	LastSeen    int64  `json:"lastSeen"`
	FirmwareVer string `json:"firmwareVer"`
}

var (
	deviceStatus      DeviceStatus
	deviceStatusMutex sync.Mutex
)

func parseBoardOutput(str string) {
	// 简单的字符串匹配
	// "AUTH_REQUIRED MAC:xxxx"
	// "MAC:xxxx"
	// "STATUS: HID Connected."

	deviceStatusMutex.Lock()
	defer deviceStatusMutex.Unlock()

	deviceStatus.Connected = true
	deviceStatus.LastSeen = time.Now().Unix()

	if idx := strings.Index(str, "MAC:"); idx != -1 {
		// 提取 MAC
		start := idx + 4
		if start+12 <= len(str) {
			mac := str[start : start+12]
			// 简单验证是否为 hex
			valid := true
			for _, c := range mac {
				if !((c >= '0' && c <= '9') || (c >= 'A' && c <= 'F') || (c >= 'a' && c <= 'f')) {
					valid = false
					break
				}
			}
			if valid {
				deviceStatus.MAC = mac
				if deviceStatus.Status == "" {
					deviceStatus.Status = "unknown"
				}
			}
		}
	}

	if strings.Contains(str, "AUTH_REQUIRED") {
		deviceStatus.Status = "auth_required"
		log.Printf("[AUTH] 设备未激活！请在配置页面输入激活码。MAC: %s", deviceStatus.MAC)
	}

	if strings.Contains(str, "INFO: License saved") {
		deviceStatus.Status = "active"
		log.Println("[AUTH] 设备激活成功！")
	}

	if strings.Contains(str, "INFO: HID ready.") {
		deviceStatus.Status = "active"
		log.Println("[AUTH] 设备已就绪 (已激活)")
	}

	if idx := strings.Index(str, "HANDSHAKE:"); idx != -1 {
		ver := strings.TrimSpace(str[idx+10:])
		deviceStatus.FirmwareVer = ver
		log.Printf("[INIT] 握手成功，固件版本: %s", ver)
	}

	// 保存到文件供 UI 读取
	saveDeviceStatus()
}

func saveDeviceStatus() {
	b, _ := json.Marshal(deviceStatus)
	_ = os.WriteFile(filepath.Join("windows_sender", "device_status.json"), b, 0644)
}

// 读取配置文件，若不存在则创建默认配置
func loadOrCreateConfig() (*Config, string, error) {
	dir := filepath.Join(".", "windows_sender")
	os.MkdirAll(dir, 0755)
	cfgPath := filepath.Join(dir, "config.json")
	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		def := &Config{
			Port:         "",
			Rotation:     0,     // 默认不旋转
			ToggleKey:    "ALT", // 默认 ALT 键切换
			SendInterval: 8,
			KeyMap: map[string]KeyConfig{
				"SPACE": {X: 0.5, Y: 0.75}, // 50%, 75%
				"W":     {X: 0.5, Y: 0.33}, // 50%, 33%
				"A":     {X: 0.33, Y: 0.66},
				"S":     {X: 0.5, Y: 0.66},
				"D":     {X: 0.66, Y: 0.66},
			},
			MouseWheels: nil,
			ViewArea:    nil,
			AntiCheat: &AntiCheatConfig{
				RandomOffsetRange: 0.005, // 约等于 1080p 下的 5px
				MicroMoveRange:    0.008, // 约等于 1080p 下的 8-9px
				MicroMoveSpeed:    0.05,
				MicroMoveDelay:    1000,
			},
		}
		cb, _ := json.MarshalIndent(def, "", "  ")
		_ = os.WriteFile(cfgPath, cb, 0644)
		return def, cfgPath, nil
	}
	raw, err := os.ReadFile(cfgPath)
	if err != nil {
		return nil, cfgPath, err
	}
	var cfg Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, cfgPath, err
	}

	// 自动迁移逻辑：如果检测到旧的 TargetWidth/Height，且坐标值大于 1.0，则进行归一化
	migrated := false
	if cfg.LegacyTargetWidth > 0 && cfg.LegacyTargetHeight > 0 {

		if cfg.ReferenceWidth == 0 {
			cfg.ReferenceWidth = cfg.LegacyTargetWidth
			cfg.ReferenceHeight = cfg.LegacyTargetHeight
			migrated = true
		}

		w, h := float64(cfg.LegacyTargetWidth), float64(cfg.LegacyTargetHeight)

		// 迁移 KeyMap
		for k, v := range cfg.KeyMap {
			if v.X > 1.0 || v.Y > 1.0 {
				v.X = v.X / w
				v.Y = v.Y / h
				cfg.KeyMap[k] = v
				migrated = true
			}
		}
		// 迁移 MouseWheels
		for i := range cfg.MouseWheels {
			mw := &cfg.MouseWheels[i]
			if mw.X > 1.0 || mw.Y > 1.0 {
				mw.X = mw.X / w
				mw.Y = mw.Y / h
				migrated = true
			}
			if mw.Radius > 1.0 {
				mw.Radius = mw.Radius / h
			}
		}

		// MovementWheel
		if cfg.MovementWheel != nil {
			if cfg.MovementWheel.Center.X > 1.0 || cfg.MovementWheel.Center.Y > 1.0 {
				cfg.MovementWheel.Center.X /= w
				cfg.MovementWheel.Center.Y /= h
				migrated = true
			}
			if cfg.MovementWheel.Radius > 1.0 {
				cfg.MovementWheel.Radius /= h // Radius 归一化 (基于高度)
			}
			if cfg.MovementWheel.WalkRadius > 1.0 {
				cfg.MovementWheel.WalkRadius /= h // WalkRadius 归一化 (基于高度)
			}
		}

		// ViewArea
		if cfg.ViewArea != nil {
			if cfg.ViewArea.Center.X > 1.0 || cfg.ViewArea.Center.Y > 1.0 {
				cfg.ViewArea.Center.X /= w
				cfg.ViewArea.Center.Y /= h
				migrated = true
			}
			if cfg.ViewArea.Width > 1.0 {
				cfg.ViewArea.Width /= w
			}
			if cfg.ViewArea.Height > 1.0 {
				cfg.ViewArea.Height /= h
			}
		}

		if migrated {
			log.Printf("[CONFIG] 检测到旧版像素坐标配置，已自动迁移为百分比坐标 (基准: %dx%d)", cfg.LegacyTargetWidth, cfg.LegacyTargetHeight)
			// 清除旧字段
			cfg.LegacyTargetWidth = 0
			cfg.LegacyTargetHeight = 0
		}
	}

	if cfg.SendInterval <= 0 {
		cfg.SendInterval = 8
	}
	var needsSave bool = migrated
	if cfg.AntiCheat == nil {
		cfg.AntiCheat = &AntiCheatConfig{
			RandomOffsetRange: 5.0,
			MicroMoveRange:    10.0,
			MicroMoveSpeed:    0.05,
			MicroMoveDelay:    1000,
		}
		needsSave = true
	} else {
		if cfg.AntiCheat.MicroMoveDelay == 200 && cfg.AntiCheat.MicroMoveSpeed == 0.5 {
			log.Println("[CONFIG] 检测到旧的防检测参数，自动更新为更平滑的设置")
			cfg.AntiCheat.MicroMoveDelay = 1000
			cfg.AntiCheat.MicroMoveSpeed = 0.05
			needsSave = true
		}
		// 设置默认 Drift 参数
		if cfg.AntiCheat.DriftHoldTimeMin == 0 {
			cfg.AntiCheat.DriftHoldTimeMin = 200
			cfg.AntiCheat.DriftHoldTimeMax = 1500
			cfg.AntiCheat.DriftDurationMin = 50
			cfg.AntiCheat.DriftDurationMax = 150
			needsSave = true
		}
	}

	if needsSave {
		cb, _ := json.MarshalIndent(&cfg, "", "  ")
		_ = os.WriteFile(cfgPath, cb, 0644)
		log.Println("[CONFIG] 配置文件已更新")
	}

	return &cfg, cfgPath, nil
}

// 返回半径内的随机偏移 (dx, dy)
func randomPointInCircle(radius float64) (float64, float64) {
	return 0, 0
}

// 返回矩形区域内的随机偏移 (dx, dy)
func randomPointInRect(w, h float64) (float64, float64) {
	return 0, 0
}

// 将当前值向目标值移动 step 距离
func moveTowards(current, target, step float64) float64 {
	if math.Abs(target-current) <= step {
		return target
	}
	if target > current {
		return current + step
	}
	return current - step
}

// 获取当前屏幕坐标的归一化值 (0.0-1.0)
// 如果遮罩启用，则相对于遮罩窗口；否则相对于全屏幕
func getScreenNormalized(x, y int32) (float64, float64) {
	// Check overlay status
	overlayRectMutex.RLock()
	active := overlayEnabled
	ox, oy, ow, oh := overlayRect.X, overlayRect.Y, overlayRect.W, overlayRect.H
	overlayRectMutex.RUnlock()

	var baseX, baseY float64
	var baseW, baseH float64

	if active && ow > 0 && oh > 0 {
		baseX = float64(x) - float64(ox)
		baseY = float64(y) - float64(oy)
		baseW = float64(ow)
		baseH = float64(oh)
	} else {
		// Fallback to fullscreen
		screenW := getSystemMetrics(0) // SM_CXSCREEN
		screenH := getSystemMetrics(1) // SM_CYSCREEN
		if screenW <= 0 {
			screenW = 1920
		}
		if screenH <= 0 {
			screenH = 1080
		}
		baseX = float64(x)
		baseY = float64(y)
		baseW = float64(screenW)
		baseH = float64(screenH)
	}

	nx := baseX / baseW
	ny := baseY / baseH

	if nx < 0 {
		nx = 0
	}
	if nx > 1 {
		nx = 1
	}
	if ny < 0 {
		ny = 0
	}
	if ny > 1 {
		ny = 1
	}
	return nx, ny
}

// 发送一次快速点击动作
func tapAt(port serial.Port, id uint8, nx, ny float64, cfg *Config) {
	_ = sendTouchFromNormalized(port, ActionDown, id, nx, ny, cfg)
	time.Sleep(50 * time.Millisecond)
	_ = sendTouch(port, ActionUp, id, 0, 0)
}

// 鼠标开始了
func runMouseLoop(port serial.Port, cfg *Config) {
	type mouseBtnState struct {
		active                       bool
		pressTime                    time.Time
		pressOriginX, pressOriginY   float64
		currX, currY                 float64
		targetOffsetX, targetOffsetY float64
	}
	lmbState := &mouseBtnState{}
	rmbState := &mouseBtnState{}
	slideState := &mouseBtnState{}

	var lastPressed bool
	var lastX, lastY float64
	interval := time.Duration(cfg.SendInterval) * time.Millisecond
	if cfg.PollingRate > 0 {
		interval = time.Second / time.Duration(cfg.PollingRate)
		if debugMode {
			log.Printf("[INIT] 使用自定义回报率: %d Hz (间隔: %v)", cfg.PollingRate, interval)
		}
	} else if debugMode {
		log.Printf("[INIT] 使用默认发送间隔: %d ms", cfg.SendInterval)
	}

	anchored := cfg.ViewArea != nil && cfg.ViewArea.Anchored
	useButton := -1
	if cfg.ViewArea != nil {
		if cfg.ViewArea.Button == "LMB" {
			useButton = VK_LBUTTON
		} else if cfg.ViewArea.Button == "RMB" {
			useButton = VK_RBUTTON
		} else if cfg.ViewArea.Button != "NONE" && cfg.ViewArea.Button != "" {
			if vk, ok := nameToVK(cfg.ViewArea.Button); ok {
				useButton = vk
			}
		}
	}
	var anchorActive bool
	var lastAnchorX, lastAnchorY float64
	var anchorX, anchorY float64
	var lastAnchorMoveTime time.Time
	var anchorTempReleased bool
	sens := 1.0
	accel := 0.0
	if cfg.ViewArea != nil {
		if cfg.ViewArea.Sensitivity > 0 {
			sens = cfg.ViewArea.Sensitivity
		}
		if cfg.ViewArea.Acceleration > 0 {
			accel = cfg.ViewArea.Acceleration
		}
	}

	if debugMode {
		if anchored {
			log.Printf("[MODE] 当前模式: 视角锚定 (激活键: %s, 灵敏度: %.1f, 加速度: %.2f)", cfg.ViewArea.Button, sens, accel)
		} else {
			log.Printf("[MODE] 当前模式: 全局映射 (需按住左键滑动)")
		}
	}

	var lastMoveLogTime time.Time
	toggleVK, hasToggle := nameToVK(cfg.ToggleKey)
	var toggleActive bool
	var lastTogglePressed bool
	if hasToggle && debugMode {
		log.Printf("[INIT] 切换键已配置为: %s (VK=%d)", cfg.ToggleKey, toggleVK)
	}

	// 遮罩开关键
	overlayVK, hasOverlayKey := nameToVK(cfg.OverlayKey)
	if cfg.OverlayKey == "" {
		overlayVK = 0x77 // F8
		hasOverlayKey = true
		log.Printf("[INIT] 遮罩开关键默认为: F8")
	} else if hasOverlayKey {
		log.Printf("[INIT] 遮罩开关键已配置为: %s (VK=%d)", cfg.OverlayKey, overlayVK)
	}
	var lastOverlayPressed bool

	var lastDiagnosticPressed bool
	var pendingMouseWheel *MouseWheelConfig
	var pendingStartTime time.Time

	pixelToNorm := func(px, py float64) (float64, float64) {

		overlayRectMutex.RLock()
		active := overlayEnabled
		ow, oh := float64(overlayRect.W), float64(overlayRect.H)
		overlayRectMutex.RUnlock()

		var w, h float64
		if active && ow > 0 && oh > 0 {
			w, h = ow, oh
		} else {
			w = float64(getSystemMetrics(0))
			h = float64(getSystemMetrics(1))
		}

		// 动态分辨率优化：
		if w > 0 && h > 0 {
			lastValidScreenWidth = w
			lastValidScreenHeight = h
		} else {
			if lastValidScreenWidth > 0 && lastValidScreenHeight > 0 {
				w = lastValidScreenWidth
				h = lastValidScreenHeight
			} else {
				w = 1920
				h = 1080
			}
		}

		return px / w, py / h
	}

	for {
		pos, err := getCursorPos()
		if err != nil {
			time.Sleep(interval)
			continue
		}

		// 处理层切换
		if hasOverlayKey {
			isOverlayDown := getAsyncKeyState(overlayVK)
			if isOverlayDown && !lastOverlayPressed {

				overlayRectMutex.Lock()
				overlayEnabled = !overlayEnabled
				newState := overlayEnabled
				overlayRectMutex.Unlock()

				if overlayHwnd != 0 {
					cmd := uintptr(SW_HIDE)
					if newState {
						cmd = uintptr(SW_SHOW)
					}
					procShowWindow.Call(overlayHwnd, cmd)
				}

				stateStr := "已关闭 (全屏模式)"
				if newState {
					stateStr = "已开启 (窗口模式)"
				}
				log.Printf("[UI] 遮罩层状态切换: %s", stateStr)
				updateCursorClip(newState)
			}
			lastOverlayPressed = isOverlayDown
		}

		isF9Down := getAsyncKeyState(0x78)
		isCtrlDown := getAsyncKeyState(VK_CONTROL)
		if isCtrlDown && isF9Down && !lastDiagnosticPressed {
			go runDiagnosticTest(port, cfg)
		}
		lastDiagnosticPressed = isCtrlDown && isF9Down

		if activeMouseWheel == nil {
			if pendingMouseWheel == nil {
				for i := range cfg.MouseWheels {
					mw := &cfg.MouseWheels[i]
					vk, ok := nameToVK(mw.Key)
					if ok && getAsyncKeyState(vk) {
						if mw.TriggerTime <= 0 {
							activeMouseWheel = mw
						} else {
							pendingMouseWheel = mw
							pendingStartTime = time.Now()
						}
						break
					}
				}
			} else {
				vk, _ := nameToVK(pendingMouseWheel.Key)
				isDown := getAsyncKeyState(vk)
				if isDown {
					if time.Since(pendingStartTime) >= time.Duration(pendingMouseWheel.TriggerTime)*time.Millisecond {
						activeMouseWheel = pendingMouseWheel
						pendingMouseWheel = nil
						if debugMode {
							log.Printf("[WHEEL] 长按触发轮盘 (Key: %s)", activeMouseWheel.Key)
						}
					}
				} else {
					if debugMode {
						log.Printf("[WHEEL] 短按触发点击 (Key: %s)", pendingMouseWheel.Key)
					}
					tapAt(port, mouseWheelTouchID, pendingMouseWheel.X, pendingMouseWheel.Y, cfg)
					pendingMouseWheel = nil
				}
			}

			if activeMouseWheel != nil {
				if debugMode {
					log.Printf("[WHEEL] 激活轮盘组件 (Key: %s) -> (%.2f, %.2f)", activeMouseWheel.Key, activeMouseWheel.X, activeMouseWheel.Y)
				}
				screenW := getSystemMetrics(0)
				screenH := getSystemMetrics(1)
				if screenW > 0 && screenH > 0 {
					lastValidScreenWidth = float64(screenW)
					lastValidScreenHeight = float64(screenH)
				} else if lastValidScreenWidth > 0 && lastValidScreenHeight > 0 {
					screenW = int(lastValidScreenWidth)
					screenH = int(lastValidScreenHeight)
				} else {
					screenW, screenH = 1920, 1080
				}
				showCursor(false)
				setCursorPos(screenW/2, screenH/2)
				mouseWheelLastX = activeMouseWheel.X
				mouseWheelLastY = activeMouseWheel.Y
				_ = sendTouchFromNormalized(port, ActionDown, mouseWheelTouchID, mouseWheelLastX, mouseWheelLastY, cfg)
				if anchorActive {
					_ = sendTouch(port, ActionUp, 0, 0, 0)
					anchorActive = false
				}
				time.Sleep(100 * time.Millisecond)
			}
		}

		if activeMouseWheel != nil {
			if getAsyncKeyState(VK_LBUTTON) || getAsyncKeyState(VK_RBUTTON) {
				if debugMode {
					log.Printf("[WHEEL] 轮盘组件退出 (鼠标点击)")
				}
				_ = sendTouch(port, ActionUp, mouseWheelTouchID, 0, 0)
				activeMouseWheel = nil
				if !toggleActive {
					showCursor(true)
				}
				time.Sleep(200 * time.Millisecond)
				continue
			}

			screenW := getSystemMetrics(0)
			screenH := getSystemMetrics(1)
			if screenW > 0 && screenH > 0 {
				lastValidScreenWidth = float64(screenW)
				lastValidScreenHeight = float64(screenH)
			} else if lastValidScreenWidth > 0 && lastValidScreenHeight > 0 {
				screenW = int(lastValidScreenWidth)
				screenH = int(lastValidScreenHeight)
			} else {
				screenW, screenH = 1920, 1080
			}
			centerX, centerY := screenW/2, screenH/2
			deltaX := float64(pos.X - int32(centerX))
			deltaY := float64(pos.Y - int32(centerY))

			if deltaX != 0 || deltaY != 0 {
				ndx, ndy := pixelToNorm(deltaX, deltaY)
				s := sens
				mouseWheelLastX += ndx * s
				mouseWheelLastY += ndy * s

				if activeMouseWheel.Radius > 0 {
					dx := mouseWheelLastX - activeMouseWheel.X
					dy := mouseWheelLastY - activeMouseWheel.Y
					dist := math.Hypot(dx, dy)
					if dist > activeMouseWheel.Radius {
						ratio := activeMouseWheel.Radius / dist
						mouseWheelLastX = activeMouseWheel.X + dx*ratio
						mouseWheelLastY = activeMouseWheel.Y + dy*ratio
					}
				}
				_ = sendTouchFromNormalized(port, ActionMove, mouseWheelTouchID, mouseWheelLastX, mouseWheelLastY, cfg)
				setCursorPos(centerX, centerY)
			}
			time.Sleep(interval)
			continue
		}

		if hasToggle {
			isToggleDown := getAsyncKeyState(toggleVK)
			if isToggleDown && !lastTogglePressed {
				toggleActive = !toggleActive
				if debugMode {
					if toggleActive {
						log.Printf("[MODE] 切换至 FPS视角模式 (鼠标隐藏/无限滑动)")
					} else {
						log.Printf("[MODE] 切换至 鼠标操作模式 (鼠标显示)")
					}
				}
			}
			lastTogglePressed = isToggleDown
		}

		slidePressed := toggleActive
		lmbMapped, rmbMapped := cfg.KeyMap["LMB"], cfg.KeyMap["RMB"]
		lmbPressedRaw := getAsyncKeyState(VK_LBUTTON)
		rmbPressedRaw := getAsyncKeyState(VK_RBUTTON)

		if lmbPressedRaw && !lmbState.active {
			nx, ny := getScreenNormalized(pos.X, pos.Y)
			baseX, baseY := nx, ny

			// 仅在 FPS 模式 (toggleActive) 下使用固定映射坐标 (如开火键)
			// 在鼠标操作模式 (!toggleActive) 下，使用鼠标点击位置进行映射
			useFixed := (lmbMapped.X != 0 || lmbMapped.Y != 0) && toggleActive
			if useFixed {
				baseX, baseY = lmbMapped.X, lmbMapped.Y
			}

			lmbState.active = true
			lmbState.pressTime = time.Now()

			var ox, oy float64
			// 仅在 FPS 模式下应用随机偏移
			if toggleActive {
				if useFixed && lmbMapped.Radius > 0 {
					ox, oy = randomPointInCircle(lmbMapped.Radius)
				} else {
					ox, oy = randomPointInCircle(cfg.AntiCheat.RandomOffsetRange)
				}
			} else {
				ox, oy = 0, 0
			}

			lmbState.pressOriginX = baseX + ox
			lmbState.pressOriginY = baseY + oy
			lmbState.currX, lmbState.currY = lmbState.pressOriginX, lmbState.pressOriginY
			lmbState.targetOffsetX, lmbState.targetOffsetY = 0, 0

			if debugMode {
				log.Printf("[MULTITOUCH] LMB 按下 Pos=(%.3f,%.3f)", lmbState.currX, lmbState.currY)
			}
			_ = sendTouchFromNormalized(port, ActionDown, 4, lmbState.currX, lmbState.currY, cfg)

		} else if lmbPressedRaw && lmbState.active {
			// 鼠标模式：实时跟随光标
			if !toggleActive {
				nx, ny := getScreenNormalized(pos.X, pos.Y)
				if nx != lmbState.currX || ny != lmbState.currY {
					lmbState.currX = nx
					lmbState.currY = ny
					_ = sendTouchFromNormalized(port, ActionMove, 4, lmbState.currX, lmbState.currY, cfg)
				}
				// 跳过微动逻辑
				continue
			}

		} else if !lmbPressedRaw && lmbState.active {
			if debugMode {
				log.Printf("[MULTITOUCH] LMB 松开")
			}
			_ = sendTouch(port, ActionUp, 4, 0, 0)
			lmbState.active = false
		}

		if (rmbMapped.X != 0 || rmbMapped.Y != 0) || !toggleActive {
			if rmbPressedRaw && !rmbState.active {
				rmbState.active = true
				rmbState.pressTime = time.Now()

				// 确定基准坐标
				var baseX, baseY float64
				if !toggleActive {
					// 鼠标模式：使用当前光标位置
					baseX, baseY = getScreenNormalized(pos.X, pos.Y)
				} else {
					// FPS 模式：使用映射配置
					baseX, baseY = rmbMapped.X, rmbMapped.Y
				}

				var ox, oy float64
				if toggleActive {
					if rmbMapped.Radius > 0 {
						ox, oy = randomPointInCircle(rmbMapped.Radius)
					} else {
						ox, oy = randomPointInCircle(cfg.AntiCheat.RandomOffsetRange)
					}
				} else {
					ox, oy = 0, 0
				}

				rmbState.pressOriginX = baseX + ox
				rmbState.pressOriginY = baseY + oy
				rmbState.currX, rmbState.currY = rmbState.pressOriginX, rmbState.pressOriginY
				rmbState.targetOffsetX, rmbState.targetOffsetY = 0, 0

				if debugMode {
					log.Printf("[MOUSE] RMB 按下")
				}
				_ = sendTouchFromNormalized(port, ActionDown, 3, rmbState.currX, rmbState.currY, cfg)
			} else if rmbPressedRaw && rmbState.active {
				// 鼠标模式：实时跟随光标
				if !toggleActive {
					nx, ny := getScreenNormalized(pos.X, pos.Y)
					if nx != rmbState.currX || ny != rmbState.currY {
						rmbState.currX = nx
						rmbState.currY = ny
						_ = sendTouchFromNormalized(port, ActionMove, 3, rmbState.currX, rmbState.currY, cfg)
					}
					// 跳过微动
					continue
				}

			} else if !rmbPressedRaw && rmbState.active {
				if debugMode {
					log.Printf("[MOUSE] RMB 松开")
				}
				_ = sendTouch(port, ActionUp, 3, 0, 0)
				rmbState.active = false
			}
		}

		if anchored {
			rawPressed := false
			if useButton >= 0 {
				rawPressed = getAsyncKeyState(useButton)
			}
			pressed := rawPressed || toggleActive

			screenW := getSystemMetrics(0)
			screenH := getSystemMetrics(1)
			// 动态分辨率检查
			if screenW > 0 && screenH > 0 {
				lastValidScreenWidth = float64(screenW)
				lastValidScreenHeight = float64(screenH)
			} else if lastValidScreenWidth > 0 && lastValidScreenHeight > 0 {
				screenW = int(lastValidScreenWidth)
				screenH = int(lastValidScreenHeight)
			} else {
				screenW, screenH = 1920, 1080
			}
			centerX, centerY := screenW/2, screenH/2

			if pressed && !anchorActive {
				if debugMode {
					trigger := "按键"
					if !rawPressed && toggleActive {
						trigger = "自动切换"
					}
					log.Printf("[MOUSE] 视角锚定激活 (触发: %s) - 鼠标已隐藏并锁定", trigger)
				}
				anchorActive = true
				lastAnchorMoveTime = time.Now()
				anchorTempReleased = false
				showCursor(false)
				setCursorPos(centerX, centerY)
				anchorX, anchorY = cfg.ViewArea.Center.X, cfg.ViewArea.Center.Y
				var dx, dy float64
				if cfg.ViewArea.Width > 0 && cfg.ViewArea.Height > 0 {
					dx = 0
					dy = 0
				} else {
					dx, dy = randomPointInCircle(cfg.AntiCheat.RandomOffsetRange)
				}
				anchorX += dx
				anchorY += dy
				_ = sendTouchFromNormalized(port, ActionDown, 0, anchorX, anchorY, cfg)

			} else if pressed && anchorActive {
				deltaX := float64(pos.X - int32(centerX))
				deltaY := float64(pos.Y - int32(centerY))

				if deltaX != 0 || deltaY != 0 {
					lastAnchorMoveTime = time.Now()
					if anchorTempReleased {
						if debugMode {
							log.Printf("[MOUSE] 视角滑动自动恢复 (移动检测)")
						}
						_ = sendTouchFromNormalized(port, ActionDown, 0, anchorX, anchorY, cfg)
						anchorTempReleased = false
					}

					// 计算鼠标速度 (像素/帧)
					velocity := math.Sqrt(deltaX*deltaX + deltaY*deltaY)

					// 应用加速度
					// 公式: Factor = 1.0 + (velocity * accel * 0.01)
					accelFactor := 1.0
					if accel > 0 {
						accelFactor = 1.0 + (velocity * accel * 0.05)
					}

					ndx, ndy := pixelToNorm(deltaX, deltaY)
					moveX := ndx * sens * accelFactor
					moveY := ndy * sens * accelFactor
					anchorX += moveX
					anchorY += moveY

					minX, maxX := 0.0, 1.0
					minY, maxY := 0.0, 1.0
					if cfg.ViewArea.Width > 0 && cfg.ViewArea.Height > 0 {
						halfW := cfg.ViewArea.Width / 2
						halfH := cfg.ViewArea.Height / 2
						cx, cy := cfg.ViewArea.Center.X, cfg.ViewArea.Center.Y
						minX = math.Max(0, cx-halfW)
						maxX = math.Min(1.0, cx+halfW)
						minY = math.Max(0, cy-halfH)
						maxY = math.Min(1.0, cy+halfH)
					}

					isOutOfBounds := anchorX < minX || anchorX > maxX || anchorY < minY || anchorY > maxY
					anchorX = math.Max(minX, math.Min(maxX, anchorX))
					anchorY = math.Max(minY, math.Min(maxY, anchorY))

					if isOutOfBounds {
						_ = sendTouch(port, ActionUp, 0, 0, 0)
						// 回中逻辑优化：
						// 如果配置了 ViewArea 尺寸，则在中心区域的一定比例内随机 (25%)
						var rx, ry float64
						if cfg.ViewArea.Width > 0 && cfg.ViewArea.Height > 0 {
							// 在中心 25% 的区域内随机
							rx, ry = randomPointInRect(cfg.ViewArea.Width*0.25, cfg.ViewArea.Height*0.25)
						} else {
							rx, ry = randomPointInCircle(cfg.AntiCheat.RandomOffsetRange)
						}

						anchorX = cfg.ViewArea.Center.X + rx
						anchorY = cfg.ViewArea.Center.Y + ry
						anchorX = math.Max(minX, math.Min(maxX, anchorX))
						anchorY = math.Max(minY, math.Min(maxY, anchorY))
						_ = sendTouchFromNormalized(port, ActionDown, 0, anchorX, anchorY, cfg)
						lastAnchorX, lastAnchorY = anchorX, anchorY
					} else {
						if math.Abs(anchorX-lastAnchorX) > 0.00001 || math.Abs(anchorY-lastAnchorY) > 0.00001 {
							_ = sendTouchFromNormalized(port, ActionMove, 0, anchorX, anchorY, cfg)
							lastAnchorX, lastAnchorY = anchorX, anchorY
						}
					}
					setCursorPos(centerX, centerY)
				} else {
					if cfg.ViewArea.AutoReleaseTime > 0 && !anchorTempReleased {
						if time.Since(lastAnchorMoveTime) > time.Duration(cfg.ViewArea.AutoReleaseTime)*time.Millisecond {
							if debugMode {
								log.Printf("[MOUSE] 视角滑动超时自动抬起 (超过 %d ms)", cfg.ViewArea.AutoReleaseTime)
							}
							_ = sendTouch(port, ActionUp, 0, 0, 0)
							anchorTempReleased = true
						}
					}
				}

			} else if !pressed && anchorActive {
				if debugMode {
					log.Printf("[MOUSE] 视角锚定解除 - 鼠标已显示")
				}
				_ = sendTouch(port, ActionUp, 0, 0, 0)
				anchorActive = false
				showCursor(true)
			}
		} else {
			if lmbMapped.X != 0 || lmbMapped.Y != 0 {
				if slidePressed && !lastPressed {
					lastPressed = true
					slideState.pressTime = time.Now()
					var ox, oy float64
					if lmbMapped.Radius > 0 {
						ox, oy = randomPointInCircle(lmbMapped.Radius)
					} else {
						ox, oy = randomPointInCircle(cfg.AntiCheat.RandomOffsetRange)
					}
					slideState.pressOriginX = lmbMapped.X + ox
					slideState.pressOriginY = lmbMapped.Y + oy
					slideState.currX, slideState.currY = slideState.pressOriginX, slideState.pressOriginY
					slideState.targetOffsetX, slideState.targetOffsetY = 0, 0
					if debugMode {
						log.Printf("[MOUSE] 自动按住激活 (ID=0)")
					}
					_ = sendTouchFromNormalized(port, ActionDown, 0, slideState.currX, slideState.currY, cfg)
				} else if slidePressed && lastPressed {

				} else if !slidePressed && lastPressed {
					if debugMode {
						log.Printf("[MOUSE] 自动按住结束")
					}
					_ = sendTouch(port, ActionUp, 0, 0, 0)
					lastPressed = false
				}
			} else {
				nx, ny := getScreenNormalized(pos.X, pos.Y)
				if slidePressed && !lastPressed {
					if debugMode {
						log.Printf("[MOUSE] 捕获滑动按下 (全局)")
					}
					_ = sendTouchFromNormalized(port, ActionDown, 0, nx, ny, cfg)
					lastX, lastY = nx, ny
					lastPressed = true
				} else if slidePressed && (nx != lastX || ny != lastY) {
					_ = sendTouchFromNormalized(port, ActionMove, 0, nx, ny, cfg)
					lastX, lastY = nx, ny
				} else if !slidePressed && lastPressed {
					if debugMode {
						log.Printf("[MOUSE] 捕获LMB松开")
					}
					_ = sendTouch(port, ActionUp, 0, 0, 0)
					lastPressed = false
				} else if !slidePressed && (nx != lastX || ny != lastY) {
					if debugMode && time.Since(lastMoveLogTime) > 2*time.Second {
						log.Printf("[HINT] 检测到鼠标移动，但未按住左键 (按 %s 可开启自动按住模式)", cfg.ToggleKey)
						lastMoveLogTime = time.Now()
						lastX, lastY = nx, ny
					}
				}
			}
		}
		time.Sleep(interval)
	}
}

// 现在到键盘了
func runKeyboardLoop(port serial.Port, cfg *Config) {
	type activeKeyState struct {
		pressed                      bool
		pressTime                    time.Time
		touchID                      uint8
		baseX, baseY                 float64 // 归一化
		radius                       float64
		pressOriginX, pressOriginY   float64
		currX, currY                 float64
		targetOffsetX, targetOffsetY float64
	}

	keyStates := map[int]*activeKeyState{}
	usedIDs := map[uint8]bool{}

	getFreeID := func() uint8 {
		candidates := []uint8{1, 5, 6, 7, 8, 9}
		for _, id := range candidates {
			if !usedIDs[id] {
				return id
			}
		}
		return 9
	}

	log.Printf("=== 开始初始化按键映射 (总数: %d) ===", len(cfg.KeyMap))
	for name, pt := range cfg.KeyMap {
		if name == "LMB" || name == "RMB" {
			continue
		}
		if vk, ok := nameToVK(name); ok {
			keyStates[vk] = &activeKeyState{
				baseX: pt.X, baseY: pt.Y,
				radius: pt.Radius,
			}
			if debugMode {
				log.Printf("[INIT] 映射按键成功: %s (VK=0x%02X) -> (%.2f, %.2f)", name, vk, pt.X, pt.Y)
			}
		} else {
			log.Printf("[WARN] 无法识别的按键名: %s (请检查拼写或暂不支持)", name)
		}
	}
	log.Printf("=== 按键映射初始化完成 ===")

	wasdKeys := []string{"W", "A", "S", "D"}
	for _, k := range wasdKeys {
		if vk, ok := nameToVK(k); ok {
			if _, exists := keyStates[vk]; !exists {
				keyStates[vk] = &activeKeyState{}
			}
		}
	}

	interval := time.Duration(cfg.SendInterval) * time.Millisecond
	if cfg.PollingRate > 0 {
		interval = time.Second / time.Duration(cfg.PollingRate)
	}

	log.Println("[INFO] 键盘监听循环已启动，正在轮询按键状态...")
	lastHeartbeat := time.Now()

	var wheelActive bool
	var wheelID uint8 = 2
	var wheelPressTime time.Time
	var wheelCurrX, wheelCurrY float64
	var wheelVelX, wheelVelY float64 // 物理平滑速度
	var lastBaseX, lastBaseY float64
	var lastWasdDx, lastWasdDy int // 记录上一次的 WASD 方向向量

	for {
		wasdPressed := map[string]bool{"W": false, "A": false, "S": false, "D": false}
		anyWasd := false

		for vk, st := range keyStates {
			name := vkToName(vk)
			if cfg.MovementWheel != nil && (name == "W" || name == "A" || name == "S" || name == "D") {
				isP := getAsyncKeyState(vk)
				wasdPressed[name] = isP
				if isP {
					anyWasd = true
				}
				continue
			}

			now := getAsyncKeyState(vk)
			if !now && vk >= '0' && vk <= '9' {
				numpadVK := vk + 0x30
				if _, explicit := keyStates[numpadVK]; !explicit {
					now = getAsyncKeyState(numpadVK)
				}
			}

			if now && !st.pressed {
				st.pressed = true
				st.pressTime = time.Now()
				st.touchID = getFreeID()
				usedIDs[st.touchID] = true

				var ox, oy float64
				if st.radius > 0 {
					ox, oy = randomPointInCircle(st.radius)
				} else {
					ox, oy = randomPointInCircle(cfg.AntiCheat.RandomOffsetRange)
				}

				st.pressOriginX = st.baseX + ox
				st.pressOriginY = st.baseY + oy
				st.currX, st.currY = st.pressOriginX, st.pressOriginY
				st.targetOffsetX, st.targetOffsetY = 0, 0

				if debugMode {
					log.Printf("[KEY] 按下 %s (ID=%d) Pos=(%.3f,%.3f)", name, st.touchID, st.currX, st.currY)
				}
				_ = sendTouchFromNormalized(port, ActionDown, st.touchID, st.currX, st.currY, cfg)

			} else if now && st.pressed {
				// 移除普通按键的长按微动逻辑
			} else if !now && st.pressed {
				if debugMode {
					log.Printf("[KEY] 松开 %s (ID=%d)", name, st.touchID)
				}
				_ = sendTouch(port, ActionUp, st.touchID, 0, 0)
				usedIDs[st.touchID] = false
				st.pressed = false
			}
		}

		if cfg.MovementWheel != nil {
			if anyWasd {
				dx, dy := movementVector(wasdPressed["A"], wasdPressed["D"], wasdPressed["W"], wasdPressed["S"])
				length := math.Hypot(float64(dx), float64(dy))
				if length == 0 {
					length = 1
				}

				currentRadius := cfg.MovementWheel.Radius
				if cfg.MovementWheel.ModifierKey != "" && cfg.MovementWheel.WalkRadius > 0 {
					modVK, ok := nameToVK(cfg.MovementWheel.ModifierKey)
					if ok && getAsyncKeyState(modVK) {
						currentRadius = cfg.MovementWheel.WalkRadius
					}
				}

				vecX := currentRadius * float64(dx) / length
				vecY := currentRadius * float64(dy) / length

				if !wheelActive {
					wheelActive = true
					wheelPressTime = time.Now()

					if debugMode {
						log.Printf("[WHEEL] 激活轮盘")
					}

					lastWasdDx, lastWasdDy = dx, dy

					centerX := cfg.MovementWheel.Center.X
					centerY := cfg.MovementWheel.Center.Y
					_ = sendTouchFromNormalized(port, ActionDown, wheelID, centerX, centerY, cfg)

					wheelCurrX = centerX
					wheelCurrY = centerY
					wheelVelX, wheelVelY = 0, 0

					time.Sleep(10 * time.Millisecond)
				} else {
					if dx != lastWasdDx || dy != lastWasdDy {
						lastWasdDx, lastWasdDy = dx, dy
					}

					baseX := cfg.MovementWheel.Center.X + vecX
					baseY := cfg.MovementWheel.Center.Y + vecY

					if time.Since(wheelPressTime) < 20*time.Millisecond {
						lastBaseX, lastBaseY = baseX, baseY
					}

					originX := baseX
					originY := baseY

					destX := originX
					destY := originY

					// 物理平滑处理 (Spring-Damper)
					stiffness := cfg.MovementWheel.Stiffness
					if stiffness <= 0 {
						stiffness = 0.015
					}
					damping := cfg.MovementWheel.Damping
					if damping <= 0 {
						damping = 0.25
					}

					forceX := (destX - wheelCurrX) * stiffness
					forceY := (destY - wheelCurrY) * stiffness

					forceX -= wheelVelX * damping
					forceY -= wheelVelY * damping

					wheelVelX += forceX
					wheelVelY += forceY

					wheelCurrX += wheelVelX
					wheelCurrY += wheelVelY

					if math.Abs(baseX-lastBaseX) > 0.001 || math.Abs(baseY-lastBaseY) > 0.001 {
						wheelPressTime = time.Now()
						lastBaseX, lastBaseY = baseX, baseY
					}

					_ = sendTouchFromNormalized(port, ActionMove|0x80, wheelID, wheelCurrX, wheelCurrY, cfg)
				}
			} else {
				if wheelActive {
					if debugMode {
						log.Printf("[WHEEL] 松开")
					}
					_ = sendTouch(port, ActionUp, wheelID, 0, 0)
					wheelActive = false
				}
			}
		}

		time.Sleep(interval)
		if debugMode && time.Since(lastHeartbeat) > 5*time.Second {
			log.Printf("[HEARTBEAT] 键盘监听运行中... (监听键数: %d)", len(keyStates))
			lastHeartbeat = time.Now()
		}
	}
}

// 计算移动向量
func movementVector(left, right, up, down bool) (int, int) {
	dx, dy := 0, 0
	if left {
		dx -= 1
	}
	if right {
		dx += 1
	}
	if up {
		dy -= 1
	}
	if down {
		dy += 1
	}
	return dx, dy
}

// 将按键名转换为虚拟键码
func nameToVK(name string) (int, bool) {
	switch name {
	case "LMB":
		return VK_LBUTTON, true
	case "RMB":
		return VK_RBUTTON, true
	case "SPACE":
		return VK_SPACE, true
	case "SHIFT", "LSHIFT", "RSHIFT":
		return VK_SHIFT, true
	case "CTRL", "LCTRL", "RCTRL", "CONTROL":
		return VK_CONTROL, true
	case "ALT", "LALT", "RALT":
		return VK_MENU, true
	case "W":
		return VK_W, true
	case "A":
		return VK_A, true
	case "S":
		return VK_S, true
	case "D":
		return VK_D, true
	case "X1":
		return VK_XBUTTON1, true
	case "X2":
		return VK_XBUTTON2, true
	case "MMB", "MBUTTON":
		return 0x04, true // VK_MBUTTON
	case "TAB":
		return 0x09, true
	case "ENTER":
		return 0x0D, true
	case "ESC":
		return 0x1B, true
	}

	// F1-F12
	if len(name) >= 2 && name[0] == 'F' {
		valStr := name[1:]
		if len(valStr) == 1 && valStr[0] >= '1' && valStr[0] <= '9' {
			// F1-F9
			return 0x70 + int(valStr[0]-'1'), true
		}
		if valStr == "10" {
			return 0x79, true
		}
		if valStr == "11" {
			return 0x7A, true
		}
		if valStr == "12" {
			return 0x7B, true
		}
	}

	// 0-9
	if len(name) == 1 && name[0] >= '0' && name[0] <= '9' {
		return int(name[0]), true
	}
	// A-Z
	if len(name) == 1 {
		b := name[0]
		if b >= 'A' && b <= 'Z' {
			return int(b), true
		}
	}
	return 0, false
}

// 将虚拟键码转换为按键名
func vkToName(vk int) string {
	switch vk {
	case VK_LBUTTON:
		return "LMB"
	case VK_RBUTTON:
		return "RMB"
	case 0x04:
		return "MMB"
	case VK_SPACE:
		return "SPACE"
	case VK_SHIFT:
		return "SHIFT"
	case VK_CONTROL:
		return "CTRL"
	case VK_MENU:
		return "ALT"
	case VK_W:
		return "W"
	case VK_A:
		return "A"
	case VK_S:
		return "S"
	case VK_D:
		return "D"
	case 0x09:
		return "TAB"
	case 0x0D:
		return "ENTER"
	case 0x1B:
		return "ESC"
	}
	if vk >= 0x70 && vk <= 0x7B {
		return fmt.Sprintf("F%d", vk-0x70+1)
	}
	if vk >= '0' && vk <= '9' {
		return string(rune(vk))
	}
	if vk >= 'A' && vk <= 'Z' {
		return string(rune(vk))
	}
	return fmt.Sprintf("VK_%d", vk)
}

// 监听配置文件变化并热重载
func watchConfigChanges(cfgPath string, port serial.Port) {
	var lastModTime time.Time

	for {
		time.Sleep(2 * time.Second)

		info, err := os.Stat(cfgPath)
		if err != nil {
			continue
		}

		if !lastModTime.IsZero() && info.ModTime().After(lastModTime) {
			log.Println("[CONFIG] 检测到配置文件更新，正在重载...")
			newCfg, _, err := loadOrCreateConfig()
			if err == nil {
				globalCfgMutex.Lock()
				*globalCfg = *newCfg
				globalCfgMutex.Unlock()
				log.Println("[CONFIG] 配置重载完成")

				// Check License
				if newCfg.License != "" {
					deviceStatusMutex.Lock()
					needAuth := deviceStatus.Status == "auth_required" || deviceStatus.Status == "unknown"
					deviceStatusMutex.Unlock()

					if needAuth {
						log.Printf("[AUTH] 发现新激活码，尝试激活: %s", newCfg.License)
						port.Write([]byte(fmt.Sprintf("ACTIVATE:%s\n", newCfg.License)))
					}
				}

			} else {
				log.Printf("[CONFIG] 重载失败: %v", err)
			}
		}
		lastModTime = info.ModTime()
	}
}

func main() {
	rand.Seed(time.Now().UnixNano())
	fmt.Println("QInETouch - 发送端：捕获鼠标/键盘并通过串口发送触摸事件")
	fmt.Println("                                            by 清河")
	fmt.Println("免费软件，欢迎使用和反馈！/反馈QQ群1065502599")
	fmt.Println("⚠️  注意：请确保以管理员身份运行本程序，否则可能无法在游戏中捕获按键！")
	cfg, cfgPath, err := loadOrCreateConfig()
	if err != nil {
		log.Fatalf("加载配置失败: %v", err)
	}
	fmt.Printf("配置文件: %s\n", cfgPath)

	port, selected, err := openSerial(cfg)
	if err != nil {
		log.Fatalf("打开串口失败: %v", err)
	}
	defer port.Close()
	fmt.Printf("已连接串口: %s (波特率 %d)\n", selected, BaudRate)

	// 设置全局变量
	globalCfg = cfg
	globalPort = port

	go serialSender(port)
	createOverlayWindow(cfg)
	resetAllTouches(port)
	checkInitialKeyStates(cfg)

	// 启动配置热重载监听
	go watchConfigChanges(cfgPath, port)

	// 检查是否有激活码并尝试激活
	if cfg.License != "" {
		log.Printf("[AUTH] 检测到本地激活码，正在发送激活指令...")
		port.Write([]byte(fmt.Sprintf("ACTIVATE:%s\n", cfg.License)))
	}

	go runMouseLoop(port, cfg)
	runKeyboardLoop(port, cfg)
}

func checkInitialKeyStates(cfg *Config) {
	log.Println("[INIT] 正在检查初始按键状态...")
	if getAsyncKeyState(VK_LBUTTON) {
		log.Println("[WARN] 检测到左键 (LMB) 在启动时处于按下状态")
	}
	if getAsyncKeyState(VK_RBUTTON) {
		log.Println("[WARN] 检测到右键 (RMB) 在启动时处于按下状态")
	}
	for name := range cfg.KeyMap {
		if vk, ok := nameToVK(name); ok {
			if getAsyncKeyState(vk) {
				log.Printf("[WARN] 检测到按键 %s (VK=%d) 在启动时处于按下状态", name, vk)
			}
		}
	}
}

func resetAllTouches(port serial.Port) {
	log.Println("[INIT] 正在重置所有触摸点状态...")
	for round := 0; round < 2; round++ {
		for id := uint8(0); id < 16; id++ {
			sendPacket(ActionUp, id, 0, 0, 0)
			time.Sleep(8 * time.Millisecond)
		}
		time.Sleep(50 * time.Millisecond)
	}
	log.Println("[INIT] 触摸点重置完成")
}
