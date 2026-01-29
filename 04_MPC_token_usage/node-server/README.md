# Google Token Usage MCP Server (Node.js)

这是一个 Node.js 版本的 MCP 服务，提供与 Python 版本相同的功能：查询 Google Cloud 中的 Gemini/Vertex AI Token 使用量。

## 目录结构

*   `src/index.ts`: 服务器主代码
*   `Dockerfile`: 用于构建 Docker 镜像 (推荐用于 Cloud Run)
*   `vercel.json`: Vercel 配置文件 (实验性)

## 本地开发

1.  安装依赖:
    ```bash
    npm install
    ```
2.  设置认证环境变量 (如果不在 Google Cloud 环境中):
    ```bash
    export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/key.json"
    ```
3.  运行服务器:
    ```bash
    npm run dev
    ```
    服务器将在 `http://localhost:3000` 启动。

## 部署选项

### 推荐: Google Cloud Run (或任何 Docker 容器平台)

MCP 协议依赖 SSE (Server-Sent Events) 长连接。**Cloud Run** 或 **Render** 等支持容器的平台是最佳选择，因为它们可以保持单个实例运行并正确处理连接状态。

1.  构建 Docker 镜像:
    ```bash
    docker build -t google-token-mcp .
    ```
2.  运行:
    ```bash
    docker run -p 3000:3000 -e GOOGLE_APPLICATION_CREDENTIALS=... google-token-mcp
    ```

### Vercel 部署 (注意事项)

您可以使用提供的 `vercel.json` 部署到 Vercel。

**警告**: Vercel Serverless Functions 是无状态的。MCP 的 SSE 连接需要维持会话状态。
如果 Vercel 在 `GET /sse` 和 `POST /messages` 请求之间切换了底层运行实例，**连接将会失败**。
对于低流量的个人使用，这可能偶尔能工作，但**不推荐**用于生产环境的 MCP 服务。

如果您必须在 Vercel 上运行，建议尝试使用 Vercel 的 Web Service 模式（如果可用）或确保会话粘性。

## API 端点

*   `GET /sse`: 建立 MCP SSE 连接
*   `POST /messages`: 发送 JSON-RPC 消息 (需要 `?sessionId=...` 参数)
