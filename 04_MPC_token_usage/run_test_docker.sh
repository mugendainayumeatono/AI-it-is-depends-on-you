#!/bin/bash

# 设置镜像名称
IMAGE_NAME="gcp-token-usage-mcp"
FORCE_BUILD=false

# 解析输入参数
PROJECT_ID=""
DEBUG_MODE=""
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -b|--build) FORCE_BUILD=true; shift ;;
        -d|--debug) DEBUG_MODE="-e MCP_DEBUG=true"; shift ;;
        -*) echo "未知参数: $1"; exit 1 ;;
        *) PROJECT_ID=$1; shift ;; # 将非 - 开头的参数视为 PROJECT_ID
    esac
done

# 检查镜像是否存在，如果不存在或者需要强制构建则执行构建
if [[ "$FORCE_BUILD" == true ]] || [[ "$(docker images -q $IMAGE_NAME 2> /dev/null)" == "" ]]; then
  VERSION="v$(date +%Y%m%d-%H%M%S)"
  echo "正在构建镜像 $IMAGE_NAME:$VERSION ..."
  docker build -t $IMAGE_NAME:latest -t $IMAGE_NAME:$VERSION .
  echo "镜像构建完成，已标记为 latest 和 $VERSION"
fi

# 检查是否存在 .env 文件并导出变量
if [ -f .env ]; then
  echo "检测到 .env 文件，正在加载环境变量..."
  export $(grep -v '^#' .env | xargs)
fi

# 设置凭据路径
if [ -n "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
  CREDENTIALS_FILE="$GOOGLE_APPLICATION_CREDENTIALS"
  echo "使用环境变量中定义的凭据: $CREDENTIALS_FILE"
else
  # 默认使用 Google Cloud SDK 的标准 ADC 路径
  CREDENTIALS_FILE="$HOME/.config/gcloud/application_default_credentials.json"
  echo "未定义 GOOGLE_APPLICATION_CREDENTIALS，尝试使用默认 ADC 路径..."
fi

# 检查凭据文件是否存在
if [ ! -f "$CREDENTIALS_FILE" ]; then
  echo "错误: 未找到凭据文件: $CREDENTIALS_FILE"
  if [ -z "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
    echo "请先运行: gcloud auth application-default login"
  fi
  exit 1
fi

echo "正在启动容器并执行 MCP 测试脚本..."

# 运行容器并覆盖默认 ENTRYPOINT 来执行测试脚本
# 我们直接在命令末尾加上 python test/test_mcp_server.py
# 注意：Dockerfile 中的 ENTRYPOINT 如果是 ["python", "-u", "mcp_server.py"]，
# 则 docker run 后的参数会被作为 mcp_server.py 的参数。
# 为了灵活，我们使用 --entrypoint 覆盖它。

docker run -i --rm \
  -v "$CREDENTIALS_FILE:/app/credentials.json:ro" \
  -e GOOGLE_APPLICATION_CREDENTIALS=/app/credentials.json \
  $DEBUG_MODE \
  --entrypoint python \
  $IMAGE_NAME \
  -u test/test_mcp_server.py "$PROJECT_ID"
