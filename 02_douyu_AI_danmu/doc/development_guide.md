# 斗鱼弹幕助手开发文档

## 1. 简介

斗鱼弹幕助手是一款Chrome浏览器扩展，旨在提升斗鱼直播平台的互动体验。它允许用户手动或利用AI（当前集成Gemini）自动生成并发送弹幕，从而简化操作，增加趣味性。

## 2. 项目结构

扩展的核心文件位于 `extensions/` 目录下：

```
extensions/
├── ai_service.js      # 封装与AI模型API的交互逻辑
├── config.js          # 存放核心配置，如API选择器、Prompt等
├── content.js         # 内容脚本，注入到斗鱼页面，负责操作DOM（发送弹幕）
├── file_manager.js    # 负责处理本地文件读写（File System Access API）与IndexedDB操作
├── manifest.json      # 扩展清单文件，定义权限、入口等
├── options.html       # 扩展的设置页面，用于配置外部文件存储等高级选项
├── options.js         # 设置页面的逻辑处理脚本
├── popup.html         # 扩展的弹出界面UI
└── popup.js           # 处理弹出界面的用户交互逻辑
```

## 3. 核心功能详解

### 3.1. 手动发送弹幕

1.  **`popup.html`**: 提供一个文本输入框 (`<textarea id="message">`) 和一个“发送”按钮 (`<button id="sendButton">`)。
2.  **`popup.js`**:
    *   监听“发送”按钮的点击事件。
    *   获取输入框中的文本内容。
    *   使用 `chrome.tabs.sendMessage` 将消息（包含`action: 'sendMessage'`和弹幕内容`message`）发送给当前激活的斗鱼标签页。
    *   设置一个回调函数，根据`content.js`返回的结果，在状态栏 (`<div id="status">`) 显示“发送成功”或“发送失败”的提示。
3.  **`content.js`**:
    *   通过 `chrome.runtime.onMessage` 监听来自`popup.js`的消息。
    *   根据 `config.js` 中定义的 `danmuInputSelector` 和 `danmuSendButtonSelector` 选择器，分别找到弹幕输入框和发送按钮的DOM元素。
    *   将收到的弹幕内容填入输入框，并模拟一系列用户输入事件（`focus`, `input`, `blur`）以确保网站能够正确识别。
    *   模拟点击发送按钮。
    *   通过 `sendResponse` 将操作结果（`{status: "success"}` 或 `{status: "error", ...}`）返回给`popup.js`。

### 3.2. AI生成弹幕

1.  **`popup.html`**:
    *   提供“AI生成弹幕”按钮 (`<button id="aiGenerateButton">`)。
    *   提供AI接口 (`providerSelect`)、API密钥 (`apiKey`) 和AI模型 (`modelSelect`) 的设置选项。
2.  **`popup.js`**:
    *   **设置管理**：
        *   从`chrome.storage.sync`加载并保存用户的API密钥和模型偏好。
        *   当用户更改API密钥或AI接口时，自动调用`ai_service.js`的`listAvailableModels`方法，动态填充模型下拉列表。
    *   **生成流程**：
        *   监听“AI生成弹幕”按钮的点击事件。
        *   进行输入校验（确保API密钥、接口、模型都已选择）。
        *   调用 `ai_service.js` 的 `generateDanmu` 方法，传入必要的认证信息和模型选择。
        *   在请求期间，在状态栏显示“AI正在生成弹幕...”。
        *   成功时，将返回的弹幕文本填入输入框，并显示成功提示。
        *   失败时，在状态栏显示详细的错误信息。
3.  **`ai_service.js`**:
    *   **`generateDanmu`**:
        *   根据选择的 `provider` (如 'gemini')，调用相应的API方法。
        *   从 `config.js` 获取核心的 `prompt`。
    *   **`callGeminiAPI`**:
        *   构造符合Gemini API要求的请求体（Request Body），其中包含从`config.js`获取的`prompt`。
        *   使用 `fetch` API向Gemini的API端点发送POST请求。
        *   处理API的响应：解析返回的JSON数据，提取生成的文本内容。
        *   进行错误处理，如果API返回非200状态码，则抛出包含错误信息的异常。
    *   **`listAvailableModels`**:
        *   向Gemini的`models`端点发送GET请求，以获取用户API密钥下所有可用的模型。
        *   筛选出支持内容生成的`gemini`模型并返回列表。

### 3.3. 核心配置

**`config.js`** 文件是整个扩展的“控制中心”，它将可变配置与业务逻辑分离。

*   **`aiProviders`**: 定义了支持的AI服务商列表，方便未来扩展（如添加OpenAI）。
*   **`prompt`**: 这是AI生成弹幕的灵魂。它是一个精心设计的提示，用于指导AI模型的输出风格、内容和格式，确保生成的弹幕符合直播间互动场景。
*   **`danmuInputSelector`** & **`danmuSendButtonSelector`**: 这是连接扩展与斗鱼页面的桥梁。通过CSS选择器，`content.js`可以精确地定位到目标元素。如果斗鱼前端代码更新导致选择器失效，只需在此处修改即可，无需改动核心逻辑代码。

### 3.4. 外部配置管理 (Local File Sync)

为了方便调试和配置共享，插件支持将配置（API Key, Prompt等）保存到本地 JSON 文件中。

1.  **`options.html` & `options.js`**:
    *   提供独立设置页面，通过 `popup.html` 右上角的设置按钮进入。
    *   使用 **File System Access API** (`window.showSaveFilePicker`) 获取用户指定文件的读写权限。
    *   **手动模式**：用户可以点击按钮手动将当前配置保存到文件，或从文件读取配置覆盖当前设置。
    *   **自动同步 (Auto-Sync)**：开启后，插件会在启动时自动从文件加载配置，并在配置发生更改时自动写入文件。
2.  **`file_manager.js`**:
    *   封装文件系统操作。
    *   使用 **IndexedDB** (`DouyuDanmuDB`) 持久化存储文件句柄 (`FileSystemFileHandle`)，确保浏览器重启后只需重新验证权限即可再次访问文件，无需用户重新选择文件。

## 4. 如何扩展

### 添加新的AI服务商 (例如 OpenAI)

1.  **`config.js`**: 在 `aiProviders` 数组中添加新的服务商对象。
    ```javascript
    { name: 'OpenAI', value: 'openai' }
    ```
2.  **`ai_service.js`**:
    *   在 `generateDanmu` 方法中，为 `'openai'` 添加一个新的逻辑分支。
    *   实现一个新的方法 `callOpenAIAPI(...)`，封装调用OpenAI API的逻辑（包括构建请求、发送请求、处理响应和错误）。
    *   如果需要，实现 `listOpenAIModels(...)` 方法来动态获取模型列表，并在`popup.js`的`populateModelsDropdown`中添加相应的调用逻辑。
3.  **`popup.js`**: 如果新服务商的模型加载方式不同，需要在 `populateModelsDropdown` 函数中增加对应的处理逻辑。

## 5. 注意事项

*   **API密钥安全**：API密钥存储在 `chrome.storage.sync` 中，这比硬编码在代码中更安全，但用户仍需妥善保管自己的密钥。
*   **选择器健壮性**：斗鱼前端的更新可能会导致CSS选择器失效。届时需要更新 `config.js` 中的选择器。
*   **错误处理**：大部分错误（如API密钥无效、网络问题、模型加载失败）都会通过 `popup.html` 的状态栏反馈给用户，便于排查问题。

## 6. 更新履历

### 2026-01-24
*   **新增功能**: 添加配置页 (`options.html`)，支持将配置保存到本地 JSON 文件。
*   **新增功能**: 实现“自动同步”功能，可将本地文件作为配置的单一数据源。
*   **UI优化**: 在 Popup 界面增加设置按钮入口。
*   **代码重构**: 新增 `file_manager.js` 模块，统一处理文件系统与 IndexedDB 操作。
