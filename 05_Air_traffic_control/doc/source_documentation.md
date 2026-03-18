# 源代码说明文档

本文档详细说明了 `RadioPlugin/src` 目录下各源文件的功能、函数用途、用法以及待办事项。

---

## 1. `RadioPlugin.cpp` (插件主入口)

### 功能概述
该文件是 X-Plane 12 插件的核心入口点。负责插件的生命周期管理（启动、停止、启用、禁用）、初始化子系统，并实现频率监控与 PTT (Push-to-Talk) 拦截逻辑。

### 核心函数
*   **`XPluginStart`**: 插件加载时调用。注册插件信息、查找 DataRefs、初始化音频子系统，并注册 PTT 命令拦截器。
*   **`XPluginStop`**: 插件卸载时调用。注销命令拦截器，清理音频资源。
*   **`PTTCommandHandler`**: **关键回调**。当玩家按下/松开无线电发射键时触发。
    *   **逻辑**：检查 COM1 是否调至目标频率（121.500 MHz）。若是，则拦截该命令并调用 `StartRecording()`/`StopRecording()`，同时返回 `0` 以阻止 X-Plane 原生发射逻辑。

### 待实现功能
*   **多频率支持**：目前硬编码为单一频率，未来应改为可配置的频率列表。
*   **COM2 支持**：目前仅实现了 COM1 的接管逻辑。

---

## 2. `AudioPlayback.cpp` / `.h` (音频播报模块)

### 功能概述
负责将外部 PCM 音频数据（如 AI 生成的 ATC 语音）推送到 X-Plane 12 的音频引擎中。

### 核心函数
*   **`PlayVoiceAudio(pcmData)`**: 接收 16-bit 44100Hz 单声道 PCM 数据，并使用 `XPLMPlayPCMOnBus` 将其播放到 `xplm_AudioRadioCom1` 总线。
*   **`MySoundCompleteCallback`**: 音频播放结束后的清理回调，负责释放 PCM 数据内存。

### 用法
```cpp
std::vector<int16_t> audioData = ...; // 获取音频流
PlayVoiceAudio(audioData);
```

### 待实现功能
*   **队列管理**：目前若正在播放音频会直接忽略新请求，未来应实现音频队列（FIFO）。
*   **音量控制**：增加动态调整播报音量的功能。

---

## 3. `AudioCapture.cpp` / `.h` (麦克风采集模块)

### 功能概述
负责在玩家按下 PTT 时捕获麦克风输入。

### 核心函数
*   **`StartRecording()`**: 开始录音。目前为 Stub 实现，预留了 FMOD `recordStart` 调用位置。
*   **`StopRecording()`**: 停止录音。目前为 Stub 实现，预留了提取 PCM 数据并准备发送至网络的位置。

### 待实现功能
*   **FMOD 深度集成**：目前仅为框架，需要链接 `fmod.lib` 并实现具体的循环缓冲区读取逻辑。
*   **VAD (语音活动检测)**：增加静音检测以优化网络带宽。

---

## 4. 必要信息与注意事项

### 内存管理
*   **播放缓冲区**：由于 `XPLMPlayPCMOnBus` 不拷贝数据，必须保证数据在播放期间常驻内存。本项目采用 `new` 分配并在完成回调中 `delete` 的策略。

### 线程安全
*   所有 SDK 函数调用（如 `XPLMGetData`）必须在主线程执行。如果未来引入网络模块，请确保网络回调通过线程安全的队列回到主线程处理。

### 依赖关系
*   需要 X-Plane SDK 4.0 或更高版本。
*   如需启用录音功能，需自行在 CMake 中链接 FMOD Studio API 库。
