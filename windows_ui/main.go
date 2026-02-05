package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// AppConfigRequest 定义前端提交的配置信息结构
// 包含目标分辨率、按键映射、移动轮盘与视角区域等
type AppConfigRequest struct {
	Port            string               `json:"port"`
	Rotation        int                  `json:"rotation"`
	ToggleKey       string               `json:"toggleKey"`
	ReferenceWidth  int                  `json:"uiReferenceWidth"`  // UI编辑时的参考宽度
	ReferenceHeight int                  `json:"uiReferenceHeight"` // UI编辑时的参考高度
	OverlayScale    float64              `json:"overlayScale"`      // 遮罩层缩放比例
	OverlayKey      string               `json:"overlayKey"`        // 遮罩层开关快捷键
	KeyMap          map[string]KeyConfig `json:"keyMap"`
	MovementWheel   *MovementConfig      `json:"movementWheel,omitempty"`
	MouseWheels     []MouseWheelConfig   `json:"mouseWheels,omitempty"`
	ViewArea        *ViewConfig          `json:"viewArea,omitempty"`
	ScrollUp        *ScrollActionConfig  `json:"scrollUp,omitempty"`
	ScrollDown      *ScrollActionConfig  `json:"scrollDown,omitempty"`
	SendIntervalMs  int                  `json:"sendIntervalMs"`
	PollingRate     int                  `json:"pollingRate,omitempty"`
	License         string               `json:"license,omitempty"` // 激活码
}

// MouseWheelConfig 鼠标轮盘组件配置
type MouseWheelConfig struct {
	Key         string  `json:"key"`
	X           float64 `json:"x"`
	Y           float64 `json:"y"`
	Radius      float64 `json:"radius,omitempty"`
	TriggerTime int     `json:"triggerTime,omitempty"`
}

// KeyConfig 按键配置，包含坐标和独立的触发半径
type KeyConfig struct {
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Radius float64 `json:"radius,omitempty"`
}

// Point 坐标点
type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// MovementConfig 表示WASD按键对应的轮盘中心与半径
type MovementConfig struct {
	Center      Point   `json:"center"`
	Radius      float64 `json:"radius"`
	WalkRadius  float64 `json:"walkRadius,omitempty"`
	ModifierKey string  `json:"modifierKey,omitempty"`
	Stiffness   float64 `json:"stiffness"`
	Damping     float64 `json:"damping"`
}

// ViewConfig 表示视角滑动区域配置
type ViewConfig struct {
	Center          Point   `json:"center"`
	Width           float64 `json:"width,omitempty"`
	Height          float64 `json:"height,omitempty"`
	Anchored        bool    `json:"anchored"`
	Button          string  `json:"button"`
	Sensitivity     float64 `json:"sensitivity"`
	Acceleration    float64 `json:"acceleration,omitempty"`
	AutoReleaseTime int     `json:"autoReleaseTimeMs,omitempty"`
}

// ScrollActionConfig 滚轮事件配置
type ScrollActionConfig struct {
	Mode     string  `json:"mode"` // "tap" or "swipe"
	X        float64 `json:"x,omitempty"`
	Y        float64 `json:"y,omitempty"`
	StartX   float64 `json:"startX,omitempty"`
	StartY   float64 `json:"startY,omitempty"`
	EndX     float64 `json:"endX,omitempty"`
	EndY     float64 `json:"endY,omitempty"`
	Duration int     `json:"duration,omitempty"`
}

// handleSave 处理前端提交，保存为 windows_sender/config.json
func handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var req AppConfigRequest
	if err := json.Unmarshal(body, &req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// 读取现有配置以保留 Port, AntiCheat, Rotation 等字段
	type SenderConfig struct {
		Port            string                 `json:"port"`
		Rotation        int                    `json:"rotation"`
		KeyMap          map[string]KeyConfig   `json:"keyMap"`
		ToggleKey       string                 `json:"toggleKey"`
		SendInterval    int                    `json:"sendIntervalMs"`
		PollingRate     int                    `json:"pollingRate,omitempty"`
		MovementWheel   *MovementConfig        `json:"movementWheel,omitempty"`
		MouseWheels     []MouseWheelConfig     `json:"mouseWheels,omitempty"`
		ViewArea        *ViewConfig            `json:"viewArea,omitempty"`
		AntiCheat       map[string]interface{} `json:"antiCheat,omitempty"`
		ReferenceWidth  int                    `json:"uiReferenceWidth,omitempty"`
		ReferenceHeight int                    `json:"uiReferenceHeight,omitempty"`
		OverlayScale    float64                `json:"overlayScale,omitempty"`
		OverlayKey      string                 `json:"overlayKey,omitempty"`
		ScrollUp        *ScrollActionConfig    `json:"scrollUp,omitempty"`
		ScrollDown      *ScrollActionConfig    `json:"scrollDown,omitempty"`
		License         string                 `json:"license,omitempty"`
	}

	target := filepath.Join(".", "windows_sender", "config.json")
	var existing SenderConfig

	// 尝试读取现有文件
	if data, err := os.ReadFile(target); err == nil {
		_ = json.Unmarshal(data, &existing)
	}

	// 更新字段
	existing.Port = req.Port
	existing.Rotation = req.Rotation
	existing.ToggleKey = req.ToggleKey
	existing.ReferenceWidth = req.ReferenceWidth
	existing.ReferenceHeight = req.ReferenceHeight
	existing.OverlayScale = req.OverlayScale
	existing.OverlayKey = req.OverlayKey

	existing.KeyMap = req.KeyMap
	existing.SendInterval = req.SendIntervalMs
	existing.PollingRate = req.PollingRate
	existing.MovementWheel = req.MovementWheel
	existing.MouseWheels = req.MouseWheels
	existing.ViewArea = req.ViewArea
	existing.ScrollUp = req.ScrollUp
	existing.ScrollDown = req.ScrollDown
	existing.License = req.License

	// 如果没有 Port，保持原样或默认为 COM5 (如果原样也是空)
	if existing.Port == "" {
		existing.Port = "COM5"
	}

	b, _ := json.MarshalIndent(existing, "", "  ")
	if err := os.WriteFile(target, b, 0644); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
	w.Write([]byte(`{"ok":true}`))
}

// handleLoad 读取当前配置
func handleLoad(w http.ResponseWriter, r *http.Request) {
	target := filepath.Join(".", "windows_sender", "config.json")
	data, err := os.ReadFile(target)
	if err != nil {
		// 如果文件不存在，返回空JSON
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte("{}"))
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// handleIndex 提供前端页面
func handleIndex(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, filepath.Join(".", "windows_ui", "static", "index.html"))
}

// handleStatic 提供静态资源
func handleStatic(prefix string) http.Handler {
	dir := http.Dir(filepath.Join(".", "windows_ui", "static"))
	return http.StripPrefix(prefix, http.FileServer(dir))
}

// handleDeviceInfo 读取 windows_sender/device_status.json
func handleDeviceInfo(w http.ResponseWriter, r *http.Request) {
	target := filepath.Join(".", "windows_sender", "device_status.json")
	data, err := os.ReadFile(target)
	if err != nil {
		if os.IsNotExist(err) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"connected":false,"status":"unknown"}`))
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// main 启动本地HTTP服务器用于图形化配置
func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", handleIndex)
	mux.Handle("/static/", handleStatic("/static/"))
	mux.HandleFunc("/save", handleSave)
	mux.HandleFunc("/load", handleLoad)
	mux.HandleFunc("/device_info", handleDeviceInfo)

	port := 61701
	var err error
	for i := 0; i < 10; i++ {
		addr := fmt.Sprintf(":%d", port)
		fmt.Printf("启动UI服务器: http://localhost%s\n", addr)
		err = http.ListenAndServe(addr, mux)
		if err != nil {
			fmt.Printf("端口 %d 被占用，尝试下一个...\n", port)
			port++
		} else {
			break
		}
	}
	if err != nil {
		panic(fmt.Sprintf("无法启动服务器，已重试多次: %v", err))
	}
}
