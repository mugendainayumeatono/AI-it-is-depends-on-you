# Ban/Pick 系统部署指南 (Vercel + Neon)

本指南将指导您如何将 Ban/Pick 系统部署到 Vercel，并配置 Neon PostgreSQL 数据库。

## 1. 准备工作

*   **GitHub 账号**：用于存放代码并与 Vercel 关联。
*   **Vercel 账号**：用于托管网站。
*   **Neon 账号**：用于托管 PostgreSQL 数据库（Vercel 官方推荐的 Serverless 数据库）。

## 2. 数据库配置 (Neon)

1.  登录 [Neon.tech](https://neon.tech/)。
2.  创建一个新项目 (Create a New Project)。
3.  在仪表盘找到 **Connection String**。
4.  确保选择的是 `Pooled Connection`（URL 以 `postgres://` 开头，通常包含 `-pooler` 标志），这对于 Serverless 环境（如 Vercel）性能更好。
5.  复制该连接字符串，它看起来像这样：
    `postgresql://user:password@ep-lucky-pooler-123456.us-east-2.aws.neon.tech/neondb?sslmode=require`

## 3. 代码上传

将您的项目代码推送到 GitHub 仓库：

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <您的仓库地址>
git push -u origin main
```

## 4. Vercel 部署步骤

1.  登录 [Vercel](https://vercel.com/)。
2.  点击 **"Add New" -> "Project"**。
3.  从 GitHub 导入您的项目仓库。
4.  **配置环境变量 (Environment Variables)**：
    在部署页面找到 "Environment Variables" 区域，添加以下变量：
    *   **Key**: `DATABASE_URL`
    *   **Value**: 粘贴您从 Neon 复制的连接字符串。
5.  **配置构建命令**：
    项目已配置 `postinstall` 脚本，Vercel 会自动运行 `prisma generate`。您无需修改默认的构建设置。
6.  点击 **"Deploy"**。

## 5. 初始化数据库结构

部署完成后，由于是新数据库，您需要同步表结构。您可以在本地运行以下命令（确保本地 `.env` 文件中有正确的 `DATABASE_URL`）：

```bash
npx prisma db push
```

或者，您也可以在 Vercel 的项目控制台中，通过 **"Settings" -> "Integrations"** 关联 Neon，但这通常会自动处理变量，手动设置更为通用。

## 6. 环境变量清单

| 变量名 | 说明 | 示例 |
| :--- | :--- | :--- |
| `DATABASE_URL` | Neon 数据库的连接字符串 | `postgresql://user:pw@host/db?sslmode=require` |

## 7. 常见问题排查

*   **Prisma 报错**：如果部署时提示 `Prisma Client could not be found`，请检查 `package.json` 是否包含 `"postinstall": "prisma generate"`。
*   **数据库连接超时**：请确保在 Neon 中启用了连接池 (Connection Pooling)，并将连接字符串更新为 Pooler 版本。
*   **实时同步延迟**：系统采用 SWR 轮询（每 1 秒一次），在 Vercel 免费版上这会产生一定的请求量，但在小型使用场景下完全没有问题。

---
祝您的选人环节顺利进行！
