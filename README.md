# 🖱️ Go Touch Mapper (QInE HID)

> **高性能 Windows 键鼠映射系统**  
> 将 PC 键鼠操作转换为 Android/HID 触控信号，专为投屏游戏与硬件级宏设计。

---

## 📖 项目简介

本项目包含两个独立运行的组件，共同协作完成键鼠映射功能。采用 **前后端分离** 架构（本地 CS 模式），确保核心映射功能的极致低延迟与稳定性。

### 🏗️ 架构概览

*   **🧠 核心发射端 (`windows_sender`)**
    *   **角色**：后端引擎。
    *   **职责**：监听键盘鼠标、计算映射逻辑、通过串口发送指令。
    *   **特点**：无界面（Console）、低延迟、高权限。

*   **🎨 配置面板 (`windows_ui`)**
    *   **角色**：前端交互。
    *   **职责**：提供可视化界面，生成配置文件。
    *   **特点**：Web 界面、易于使用、即时保存。

## 🚀 快速上手

### 1. 硬件准备
*   支持 HID 触控协议的开发板（ESP32S3刷入对应固件）。
*   通过 USB 连接到电脑。

### 2. 启动核心
进入 `windows_sender` 目录并运行（需管理员权限）：
```bash
cd windows_sender
go run main.go
```
*此时控制台应显示串口连接成功日志。*

### 3. 打开配置
进入 `windows_ui` 目录并运行：
```bash
cd windows_ui
go run main.go
```
*浏览器将自动打开 `http://localhost:61701`，你可以在此调整键位。*

## 📂 目录结构

```text
.
├── 📁 windows_sender    # [核心] 映射引擎与串口发送
│   ├── 📄 main.go       # 主程序入口
│   ├── 📄 config.json   # 映射配置文件 (自动生成)
│   └── 📄 README.md     # 详细文档
│
└── 📁 windows_ui        # [工具] 可视化配置 Web 服务
    ├── 📄 main.go       # HTTP 服务器
    ├── 📁 static        # 前端资源 (HTML/CSS/JS)
    └── 📄 README.md     # 详细文档
```

## 🛠️ 编译指南

建议分别为两个模块编译可执行文件：

```bash
# 编译发送端
cd windows_sender
go build -o sender.exe main.go

# 编译UI端
cd ../windows_ui
go build -o ui.exe main.go
```

## 📝 常见问题

*   **Q: 游戏中按键没反应？**
    *   A: 请确保 `sender.exe` 是以 **管理员身份** 运行的。
*   **Q: 鼠标光标在游戏中乱飞？**
    *   A: 按 `F8` 开启遮罩层，或按 `Alt` 切换到 FPS 模式。
*   **Q: 配置文件在哪里？**
    *   A: 位于 `windows_sender/config.json`，你可以手动备份该文件。

---
*Created with ❤️ by QInE*
