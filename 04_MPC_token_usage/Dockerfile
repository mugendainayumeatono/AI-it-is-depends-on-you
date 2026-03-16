# 使用轻量级的 Python 3.10 镜像
FROM python:3.10-slim

# 设置工作目录
WORKDIR /app

# 安装必要的系统依赖（如果需要）
# 对于 Google Cloud SDK 某些功能可能需要，但基础 SDK 通常不需要额外的系统库
# RUN apt-get update && apt-get install -y --no-install-recommends \
#     build-essential \
#     && rm -rf /var/lib/apt/lists/*

# 复制依赖文件并安装
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制源代码
COPY mcp_server.py .
COPY test/ ./test/

# 设置环境变量（可选，建议在运行时通过 -e 注入）
# ENV GOOGLE_APPLICATION_CREDENTIALS=/app/credentials.json

# 暴露端口（如果是 SSE 模式需要，但 stdio 模式不需要）
# EXPOSE 8080

# 运行 MCP 服务器
# 使用 -u 确保日志实时输出
ENTRYPOINT ["python", "-u", "mcp_server.py"]
