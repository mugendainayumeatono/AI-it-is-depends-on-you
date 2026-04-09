# Ban/Pick 系统部署指南 (Vercel + Neon + Pusher)

本指南将指导您如何将 Ban/Pick 系统部署到 Vercel，并配置 Neon PostgreSQL 数据库，以及（可选地）配置 Pusher 以实现毫秒级的多端实时同步。

## 1. 准备工作

*   **GitHub 账号**：用于存放代码并与 Vercel 关联。
*   **Vercel 账号**：用于托管网站。
*   **Neon 账号**：用于托管 PostgreSQL 数据库（Vercel 官方推荐的 Serverless 数据库）。
*   **Pusher 账号** (强烈推荐)：用于提供 WebSocket 实时推送服务，大幅提升多端同步速度并减少数据库查询压力。

## 2. 数据库配置 (Neon)

1.  登录 [Neon.tech](https://neon.tech/)。
2.  创建一个新项目 (Create a New Project)。
3.  在仪表盘找到 **Connection String**。
4.  Neon 提供两个连接字符串，您将需要它们：
    *   **Pooled Connection**（用于应用程序的常规连接）。
    *   **Direct Connection**（用于数据库迁移和 `db push`）。

## 3. 实时同步服务配置 (Pusher - 推荐)

系统默认使用 HTTP 轮询（每秒一次）进行同步。为了获得即时的同步体验，建议配置 Pusher。

### 申请与注册步骤：
1.  **注册账号**：访问 [pusher.com](https://pusher.com/) 并点击 "Sign Up"。可以使用 GitHub 或 Google 账号快捷登录。
2.  **创建 Channel 应用**：
    *   登录后，进入 **Channels** 控制台。
    *   点击 **"Create app"** 按钮。
    *   **App name (应用名称)**：随意填写，例如 `banpick-sync`。
    *   **Cluster (集群)**：选择离您部署区域最近的节点（例如亚太区可选 `ap1`，美国东部可选 `us2` 等）。
    *   **Front end / Back end tech**：选择 React 和 Node.js（这仅为了显示快速入门代码，不影响实际功能）。
    *   点击 **"Create app"** 完成创建。
3.  **获取密钥 (App Keys)**：
    *   在应用页面左侧菜单点击 **"App Keys"**。
    *   您将看到 `app_id`、`key`、`secret` 和 `cluster`。请将它们保存好，稍后将在环境变量中使用。

## 4. Vercel 部署步骤

1.  将您的项目代码推送到 GitHub 仓库。
2.  登录 [Vercel](https://vercel.com/)，点击 **"Add New" -> "Project"**，从 GitHub 导入您的项目仓库。
3.  **配置环境变量 (Environment Variables)**：
    在部署配置页面，展开 "Environment Variables"，添加以下变量：

    **数据库配置（必填）：**
    *   `POSTGRES_PRISMA_URL`: 粘贴 Neon 的 **Pooled Connection** 字符串。
    *   `POSTGRES_URL_NON_POOLING`: 粘贴 Neon 的 **Direct Connection** 字符串。

    **Pusher 实时同步配置（强烈推荐）：**
    *   `NEXT_PUBLIC_SYNC_METHOD`: 填入 `PUSHER` （如果不填则默认退回每秒 HTTP 轮询）。
    *   `PUSHER_APP_ID`: 您在 Pusher 获取的 `app_id`。
    *   `NEXT_PUBLIC_PUSHER_KEY`: 您在 Pusher 获取的 `key`。
    *   `PUSHER_SECRET`: 您在 Pusher 获取的 `secret`。
    *   `NEXT_PUBLIC_PUSHER_CLUSTER`: 您在 Pusher 获取的 `cluster`（例如 `ap1`）。

4.  点击 **"Deploy"**。Vercel 会自动进行构建、初始化数据库表结构（执行 `prisma db push`），并上线您的应用。

## 5. 本地开发与调试

要在本地运行并使用全套配置：

1.  在项目根目录创建 `.env` 文件。
2.  填入以上所有的环境变量：
    ```env
    POSTGRES_PRISMA_URL="postgres://..."
    POSTGRES_URL_NON_POOLING="postgres://..."

    # Pusher 实时同步配置
    NEXT_PUBLIC_SYNC_METHOD="PUSHER"
    PUSHER_APP_ID="你的_app_id"
    NEXT_PUBLIC_PUSHER_KEY="你的_key"
    PUSHER_SECRET="你的_secret"
    NEXT_PUBLIC_PUSHER_CLUSTER="你的_cluster"
    ```
3.  运行 `npm install`。
4.  运行 `npx prisma db push` (同步数据库结构)。
5.  运行 `npm run dev` 启动本地服务器。
