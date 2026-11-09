# HTML 到 XML 转换 VBScript 脚本设计文档

## 1. 目标与背景 (Intent & Goals)
编写一个纯原生 Windows VBScript 脚本（`html2xml.vbs`），用于将 HTML 格式文件转换为结构闭合、规范的 XML 格式文件。
- **目标**：
  1. 支持将一个或多个 HTML 文件（`.html`、`.htm`）直接拖拽到脚本图标上批量转换。
  2. 输出的 XML 文件保存在源 HTML 文件的同一目录下（命名为同名 `.xml`）。
  3. **动态编码识别**：不能写死 UTF-8，需自动检测源 HTML 文件的编码（如 UTF-8、GBK/GB2312、Big5、UTF-16 等），并在 XML 声明及保存时使用该编码。
  4. **容错解析与规范化**：针对 HTML 中常见的未闭合标签（如 `<br>`, `<img>`, `<input>`）及属性，自动校正为合规闭合的 XML 节点。
- **非目标**：
  - 解释或执行 HTML 中的 JavaScript/CSS 动态脚本。
  - 依赖 Python/Node.js/tidy 等第三方工具，全过程仅依赖 Windows 自带 COM 组件。

## 2. 方案对比与选型 (Approaches)
- **方案 1（已选）：MSHTML 容错解析 + MSXML 递归重构**
  - 使用 Windows 内置 `htmlfile` (MSHTML) 读入并解析 HTML DOM，自动修复语法缺失和未闭合标签；
  - 递归遍历 MSHTML DOM 树，使用 `MSXML2.DOMDocument` 构建标准 XML 节点；
  - 优点：纯原生、零外部依赖、对不规范 HTML 容错性极高。
- **方案 2：直接使用 MSXML 加载**
  - 缺点：MSXML 要求严格的 XML 语法，遇到常见的非闭合标签（如 `<meta>`、`<br>`）会直接抛出解析异常，无法处理普通 HTML。
- **方案 3：正则文本替换 / 外部 Tidy 工具**
  - 缺点：正则难以处理复杂嵌套与属性，外部工具破坏了免安装即开即用的便捷性。

## 3. 详细设计 (Detailed Design)

### 3.1 拖拽与参数处理
- 检查 `WScript.Arguments.Count`：
  - 若为 0，弹出友好提示（说明用法：请将 HTML 文件拖拽到此脚本上运行）并退出；
  - 若大于 0，循环遍历每个传入参数，检查文件是否存在及后缀是否为 `.html` / `.htm`。
- 输出文件路径：源文件目录 + 原文件名主名 + `.xml`。

### 3.2 动态编码探测机制
1. **BOM 探测**：读取文件前 4 字节二进制数据：
   - `EF BB BF` -> `UTF-8`
   - `FF FE` -> `UTF-16LE` (Unicode)
   - `FE FF` -> `UTF-16BE`
2. **HTML Meta 标签探测**：若无 BOM，读取文件头部（前 2048 字节）作为 ASCII 字符串，通过正则表达式检索编码：
   - 模式 1：`<meta[^>]+charset=["']?([a-zA-Z0-9_\-]+)`
   - 模式 2：`<meta[^>]+content=["'][^"']*charset=([a-zA-Z0-9_\-]+)`
3. **缺省兜底**：若均未检测到，兜底采用日文默认编码（`shift_jis` / 代码页 932）。

### 3.3 HTML 内容读取与 DOM 解析
- 使用 `ADODB.Stream` 设置确定的 `Charset` 读取源 HTML 完整文本。
- 创建 `CreateObject("htmlfile")` 实例，写入 HTML 字符串并关闭输入流，生成完整的 MSHTML DOM。

### 3.4 XML 树构建与转换
- 创建 `MSXML2.DOMDocument.6.0`（如不可用降级为 `MSXML2.DOMDocument`）。
- 添加 XML 声明 ProcessingInstruction：`<?xml version="1.0" encoding="<detected_charset>"?>`。
- 递归将 MSHTML 的根节点及子节点转换为 XML：
  - **标签名称净化**：转为小写，过滤非标准字符，确保符合 XML 规范；
  - **属性提取**：遍历 `node.attributes`，仅复制有效且已指定的属性（过滤 DOM 内部无用属性与事件）；
  - **文本与注释**：分别转为 XML TextNode（由 MSXML 自动转义 `<`、`>`、`&` 等字符）与 CommentNode。

### 3.5 XML 文件的编码保存
- 使用 `ADODB.Stream` 将 XML 文本以检测到的编码写入目标文件（若为 UTF-8，可自动输出对应字节流；若为 Shift_JIS/ANSI 等，按对应字符集写入）。

### 3.6 用户交互与错误处理
- 转换过程中如果单个文件出错，记录错误信息并继续处理其余文件；
- 全部处理完毕后，通过 `WScript.Echo` 提示成功与失败的文件统计。
