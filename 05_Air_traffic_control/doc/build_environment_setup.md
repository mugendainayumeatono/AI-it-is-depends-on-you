# X-Plane 12 插件开发编译环境构筑指南

本文档旨在指导开发者如何在不同操作系统下配置编译环境，并编译 `RadioPlugin` 及其测试模块。

---

## 1. 基础依赖 (Basic Dependencies)

在开始之前，请根据您的操作系统安装以下基础工具：

### Linux (Ubuntu/Debian)
```bash
sudo apt-get update
sudo apt-get install build-essential cmake git
```

### macOS
```bash
# 需要先安装 Homebrew (https://brew.sh/)
brew install cmake git
```

### Windows
*   **编译器**：安装 [Visual Studio 2019/2022](https://visualstudio.microsoft.com/) 并勾选“使用 C++ 的桌面开发”组件。
*   **CMake**：从 [cmake.org](https://cmake.org/download/) 下载安装包或通过 `choco install cmake` 安装。

---

## 2. 获取 X-Plane SDK (SDK Setup)

本插件依赖于官方的 X-Plane SDK。请执行以下指令进行环境准备：

1.  **创建 SDK 目录**：
    ```bash
    mkdir -p RadioPlugin/SDK
    ```

2.  **下载并解压**：
    *   访问 [X-Plane Developer SDK 下载页面](https://developer.x-plane.com/sdk/sdk-downloads/)。
    *   下载最新版本的 **X-Plane 12 SDK** (SDK 4.0.0+)。
    *   将压缩包解压。

3.  **配置路径**：
    将解压后的 `CHeaders` 文件夹移动到插件的 SDK 目录下：
    ```bash
    # 假设 SDK 解压在当前目录下的 SDK_Zip 文件夹中
    mv SDK_Zip/CHeaders RadioPlugin/SDK/
    ```
    *   **预期目录结构**：`RadioPlugin/SDK/CHeaders/XPLM/XPLMDefs.h` 应存在。


---

## 3. 编译插件 (Building the Plugin)

插件主体位于 `RadioPlugin` 目录下。

### Linux / macOS
```bash
cd RadioPlugin
mkdir build && cd build
cmake ..
make
```

### Windows (PowerShell)
```powershell
cd RadioPlugin
mkdir build
cd build
cmake ..
cmake --build . --config Release
```

**编译产物**：
*   Linux: `RadioPlugin.xpl` (需重命名为 `lin.xpl` 并放入插件文件夹的 `64/` 目录)。
*   Windows: `RadioPlugin.xpl` (需重命名为 `win.xpl` 并放入插件文件夹的 `64/` 目录)。
*   macOS: `RadioPlugin.xpl` (需重命名为 `mac.xpl` 并放入插件文件夹的 `64/` 目录)。

---

## 4. 编译并运行测试 (Building and Running Tests)

测试模块位于根目录下的 `test` 文件夹中，采用 Mock 系统，无需安装 X-Plane 即可运行。

### 使用 CMake 编译 (推荐)
```bash
cd test
mkdir build && cd build
cmake ..
make
./run_tests
```

### 使用 g++ 直接编译 (快速验证)
如果您未安装 CMake，可以在 Linux 环境下执行：
```bash
g++ -Itest -Itest/XPLM -IRadioPlugin/src test/TestMain.cpp -o test/run_tests
./test/run_tests
```

---

## 5. 部署到 X-Plane 12 (Deployment)

1.  在 X-Plane 12 安装目录的 `Resources/plugins/` 下创建一个新文件夹，命名为 `RadioPlugin`。
2.  在该文件夹内创建 `64` 文件夹。
3.  根据您的系统，将编译出的 `.xpl` 文件放入 `64` 文件夹内：
    *   Linux -> `lin.xpl`
    *   Windows -> `win.xpl`
    *   macOS -> `mac.xpl`
4.  启动 X-Plane 12，并在“插件管理”菜单中确认 `ATCRadioTakeover` 已成功加载。

---

## 6. 常见问题 (Troubleshooting)

*   **找不到 XPLMDefs.h**：请检查 `RadioPlugin/CMakeLists.txt` 中的 `XPLANE_SDK_DIR` 路径是否指向了正确的 `CHeaders` 目录。
*   **FMOD 相关错误**：目前的 PTT 采集代码包含 FMOD 接口的 Stub。若要启用真实的录音功能，需下载 [FMOD Studio API](https://www.fmod.com/download) 并在 CMake 中进行链接。
