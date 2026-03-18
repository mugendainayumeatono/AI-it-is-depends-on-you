# X-Plane 12 无线电接管与语音通信插件设计文档

## 1. 项目概述 (Project Overview)
本项目旨在为 X-Plane 12 模拟飞行软件开发一个 C/C++ 插件，实现对飞机无线电系统的深度接管。插件将拦截玩家调定的特定频率，并提供双向语音通信能力：采集玩家麦克风输入并播放插件生成的音频流。

## 2. 需求分析 (Requirement Analysis)
*   **频率接管**：实时监测 COM1/COM2 频率，当调至预设频率（如 121.500 MHz）时进入接管模式。
*   **输入接管 (PTT)**：拦截 X-Plane 原生的“一键通话”(Push-to-Talk) 命令，由插件接管麦克风采集逻辑，而非默认的模拟器行为。
*   **输出接管 (播报)**：将插件生成或从网络接收的 PCM 语音数据（如 AI ATC 的回复）通过模拟器的无线电音频总线播放。
*   **沉浸感要求**：播放的语音需符合 X-Plane 12 的音效系统，受环境音量、耳机/扬声器切换等逻辑影响。

## 3. 技术选型 (Technical Selection)
*   **开发语言**：C++ 17 (官方 SDK 支持最好，性能最高)。
*   **SDK 版本**：X-Plane SDK 4.0.0+ (适配 X-Plane 12 专有的音频 API)。
*   **音频播放**：使用 `XPLMPlayPCMOnBus` 接口，直接向 `xplm_AudioRadioCom1` 总线推送数据，无需手动管理复杂的 3D 音效。
*   **麦克风采集**：通过 `XPLMGetFMODStudio()` 获取模拟器内置的 FMOD 引擎句柄，利用 FMOD 的录音功能复用玩家在模拟器内设置的硬件设备。
*   **构建系统**：CMake (支持跨平台编译：Windows/macOS/Linux)。

## 4. 架构设计 (System Architecture)

### 4.1 核心模块
*   **RadioPlugin (主入口)**：负责插件生命周期管理、DataRef 查找及 Command (PTT) 拦截。
*   **AudioCapture (输入模块)**：管理 PTT 状态机，调用 FMOD 录音 API 捕获 PCM 数据。
*   **AudioPlayback (输出模块)**：管理播放缓冲区，将外部数据源转化为 X-Plane 可识别的 PCM 流进行播报。

### 4.2 数据流向
1.  **玩家按下 PTT** -> `RadioPlugin` 拦截命令 -> `AudioCapture` 开始录音。
2.  **玩家释放 PTT** -> `AudioCapture` 结束录音 -> 数据准备发送至网络层。
3.  **插件接收语音** -> `AudioPlayback` 接收 PCM 数据 -> 调用 `XPLMPlayPCMOnBus` -> 玩家在耳机中听到 ATC 播报。

## 5. 实施路线图 (Roadmap)
1.  **Phase 1**: 基础框架搭建，实现频率监控与 PTT 按键拦截日志显示。
2.  **Phase 2**: 集成 `XPLMSound` API，验证单向音频播放（接管输出）。
3.  **Phase 3**: 集成 FMOD 或第三方录音库，验证麦克风采集（接管输入）。
4.  **Phase 4**: 网络协议对接，实现端到端的语音 AI/ATC 通信。

## 6. 注意事项 (Notes)
*   **线程安全**：X-Plane SDK 绝大部分操作必须在主线程进行，网络与音频处理需异步执行。
*   **内存管理**：PCM 缓冲区在播放期间不能被释放，需在 X-Plane 回调函数中安全清理。
