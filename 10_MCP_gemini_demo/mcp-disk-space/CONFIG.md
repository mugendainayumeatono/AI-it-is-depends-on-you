# MCP 磁盘空间服务配置指南

此服务允许 `gemini-cli` 通过 MCP 协议获取系统的磁盘剩余空间。

## 1. 环境准备

确保已安装 Node.js (建议 v18+)。

在 `mcp-disk-space` 目录下执行以下命令安装依赖（如果尚未安装）：

```bash
npm install
```

## 2. 配置 gemini-cli

要让 `gemini-cli` 使用此服务，您需要在 `gemini-cli` 的配置文件中添加该服务器。

### 配置文件位置
通常位于 `~/.config/gemini-cli/config.json` (Linux/macOS) 或相应平台的配置目录。

### 添加服务器配置
在配置文件中的 `mcpServers` 部分添加以下内容：

```json
{
  "mcpServers": {
    "disk-space": {
      "command": "node",
      "args": ["/home/mickey/git/AI-it-is-depends-on-you/10_MCP_gemini_demo/doc/mcp-disk-space/index.js"]
    }
  }
}
```

> **注意**：请确保 `args` 中的路径是 `index.js` 的**绝对路径**。在您的当前环境下，路径为 `/home/mickey/git/AI-it-is-depends-on-you/10_MCP_gemini_demo/doc/mcp-disk-space/index.js`。

## 3. 使用方法

配置完成后，启动 `gemini-cli`。您可以直接询问 Gemini 关于磁盘空间的问题，例如：

*   "查看一下当前硬盘的剩余容量。"
*   "获取根目录的磁盘使用情况。"

Gemini 将会自动调用 `get_disk_usage` 工具并为您返回结果。
