#!/bin/bash

# 定义虚拟环境名称
VENV_NAME="venv"

# 检查 Python 3 是否可用
if ! command -v python3 &> /dev/null
then
    echo "错误：未找到 python3。请确保已安装 Python 3。"
    exit 1
fi

# 检查 venv 模块是否可用
if ! python3 -m venv --help &> /dev/null
then
    echo "错误：未找到 venv 模块。在 Debian/Ubuntu 系统上，请尝试安装 'python3-venv' 包。"
    echo "例如：sudo apt install python3-venv"
    exit 1
fi

# 创建虚拟环境
echo "正在创建 Python 虚拟环境 '${VENV_NAME}'..."
python3 -m venv ${VENV_NAME}

# 检查虚拟环境是否创建成功
if [ $? -ne 0 ]; then
    echo "错误：创建虚拟环境失败。"
    exit 1
fi

# 激活虚拟环境 (根据操作系统和 shell 的不同，激活方式可能略有差异)
# 以下是 Linux/macOS 的激活方式
echo "正在激活虚拟环境..."
source ${VENV_NAME}/bin/activate

# 检查虚拟环境是否激活成功 (通过检查 VIRTUAL_ENV 环境变量)
if [ -z "$VIRTUAL_ENV" ]; then
    echo "错误：激活虚拟环境失败。请检查您的 shell 环境或激活命令。"
    exit 1
fi

echo "虚拟环境 '${VENV_NAME}' 已激活。"

# 安装依赖
echo "正在安装项目依赖..."
# 获取 install.sh 的目录
INSTALL_DIR=$(dirname "$0")
# 构建 requirements.txt 的绝对路径
REQUIREMENTS_PATH="${INSTALL_DIR}/requirements.txt"

# 检查 requirements.txt 文件是否存在
if [ -f "${REQUIREMENTS_PATH}" ]; then
    pip install -r "${REQUIREMENTS_PATH}"
    if [ $? -ne 0 ]; then
        echo "错误：安装依赖失败。"
        exit 1
    fi
    echo "依赖安装成功。"
else
    echo "警告：未找到 ${REQUIREMENTS_PATH} 文件。跳过依赖安装。"
fi

echo "安装和设置完成！"
echo "您现在可以在激活的虚拟环境中运行您的应用程序，例如：python src/app.py"

# 注意：脚本执行完毕后，虚拟环境的激活状态不会保留在父 shell 中。
# 用户需要手动激活或在脚本中执行后续命令。
