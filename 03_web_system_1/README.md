# 实时系统时间显示服务 (Real-time System Time)

这是一个基于 FastAPI 开发的简单 Web 应用，用于实时显示当前服务器的 system 时间。

## 功能
- **实时显示**：网页端通过 JavaScript 每秒自动刷新一次，实时展示服务器时间。
- **现代化 UI**：简洁美观的响应式页面设计。
- **Vercel 支持**：已配置好 `vercel.json`，可一键部署至 Vercel 云平台。

## 本地开发

### 1. 安装依赖
本项目推荐使用 [uv](https://github.com/astral-sh/uv) 进行依赖管理：
```bash
uv sync
```

### 2. 运行服务
使用以下命令启动本地开发服务器：
```bash
uv run uvicorn main:app --reload
```
启动后访问：`http://localhost:8000`

---

## 部署到 Vercel

本项目已完全适配 [Vercel](https://vercel.com/)，您可以按照以下步骤进行一键部署：

### 方法 1：通过 Git 仓库部署 (推荐)
1. 将当前项目推送至您的 GitHub、GitLab 或 Bitbucket 仓库。
2. 登录 [Vercel 控制台](https://vercel.com/new)。
3. 点击 **"Add New"** -> **"Project"**。
4. 导入对应的 Git 仓库。
5. Vercel 会自动识别项目中的 `vercel.json` 和 `requirements.txt`。
6. 点击 **"Deploy"**，等待构建完成后即可通过 Vercel 提供的 URL 访问。

### 方法 2：使用 Vercel CLI 部署
1. 确保已在本地安装 Vercel CLI：
   ```bash
   npm install -g vercel
   ```
2. 在项目根目录下执行以下命令：
   ```bash
   vercel
   ```
3. 按照命令行提示进行登录和配置（通常只需一路按回车）。
4. 部署完成后，CLI 会返回一个在线访问链接。

## 关键文件说明
- `main.py`: FastAPI 核心应用入口。
- `vercel.json`: Vercel 部署配置文件。
- `requirements.txt`: 供 Vercel 环境自动安装依赖的列表。
- `pyproject.toml`: 现代 Python 项目依赖声明文件。
