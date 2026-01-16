#!/bin/bash

# ==========================================
# Google Gemini CLI 终极安装脚本
# 1. 自动安装最新版 Node.js/npm (NodeSource 源)
# 2. 安装 @google/gemini-cli
# 3. 配置 API Key 环境
# 4. 创建 Flash 模型专用启动脚本
# ==========================================

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== 开始配置 Gemini CLI 环境 (最新版) ===${NC}"

# -----------------------------------------------------------
# 1. 环境检查与安装最新版 Node.js/npm
# -----------------------------------------------------------
if ! command -v npm &> /dev/null; then
    echo -e "${YELLOW}检测到系统中未安装 npm。${NC}"
    read -p "是否现在安装最新版本的 Node.js (含 npm)? (y/n): " confirm
    if [[ $confirm == [yY] || $confirm == [yY][eE][sS] ]]; then
        echo -e "${BLUE}正在配置最新版 Node.js 安装源...${NC}"
        
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            # 使用 NodeSource 官方安装脚本 (自动获取最新 LTS/Stable)
            if command -v curl &> /dev/null; then
                curl -fsSL https://deb.nodesource.com/setup_current.x | sudo -E bash -
                if command -v apt &> /dev/null; then
                    sudo apt-get install -y nodejs
                elif command -v yum &> /dev/null; then
                    sudo yum install -y nodejs
                fi
            else
                echo -e "${RED}错误: 需要先安装 curl。请运行: sudo apt install curl${NC}"
                exit 1
            fi
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            if command -v brew &> /dev/null; then
                brew install node
            else
                echo -e "${RED}未找到 Homebrew，请手动安装最新版 Node.js: https://nodejs.org${NC}"
                exit 1
            fi
        fi
    else
        echo -e "${RED}由于缺少环境，安装已终止。${NC}"
        exit 1
    fi
else
    # 如果已安装 npm，提示是否更新
    echo -e "${GREEN}检测到 npm 已存在 ($(npm -v))。${NC}"
    read -p "是否尝试升级 npm 到最新全球版本? (y/n): " upgrade_npm
    if [[ $upgrade_npm == [yY] ]]; then
        sudo npm install -g npm@latest
    fi
fi

# -----------------------------------------------------------
# 2. 安装 @google/gemini-cli
# -----------------------------------------------------------
echo -e "${GREEN}[步骤 1/3] 正在全局安装 @google/gemini-cli...${NC}"
# 使用最新版本安装
sudo npm install -g @google/gemini-cli@latest

if [ $? -ne 0 ]; then
    echo -e "${RED}CLI 安装失败。${NC}"
    exit 1
fi

# -----------------------------------------------------------
# 3. 创建环境变量文件
# -----------------------------------------------------------
echo -e "${GREEN}[步骤 2/3] 配置环境变量...${NC}"
ENV_FILE=".gemini_env"

read -p "请输入你的 Gemini API Key: " USER_KEY
if [ -z "$USER_KEY" ]; then
    USER_KEY="YOUR_API_KEY_HERE"
    echo -e "${YELLOW}已设为占位符，请稍后手动修改 $ENV_FILE${NC}"
fi

echo "export GEMINI_API_KEY=\"$USER_KEY\"" > $ENV_FILE
chmod 600 $ENV_FILE
echo -e "变量文件已创建: ${BLUE}$ENV_FILE${NC}"

# -----------------------------------------------------------
# 4. 创建 Flash 启动脚本
# -----------------------------------------------------------
echo -e "${GREEN}[步骤 3/3] 创建 Flash 启动脚本...${NC}"
START_SCRIPT="gemini_flash.sh"

cat << EOF > $START_SCRIPT
#!/bin/bash
# 自动加载 Key 并运行 Flash 模型

DIR="\$( cd "\$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"

if [ -f "\$DIR/$ENV_FILE" ]; then
    source "\$DIR/$ENV_FILE"
else
    echo "错误: 找不到配置文件 $ENV_FILE"
    exit 1
fi

# 执行命令并强制指定模型
gemini "\$@"
EOF

chmod +x $START_SCRIPT

# -----------------------------------------------------------
# 完成
# -----------------------------------------------------------
echo -e "\n${BLUE}======================================${NC}"
echo -e "${GREEN}安装成功！${NC}"
echo -e "Node 版本: $(node -v)"
echo -e "NPM 版本: $(npm -v)"
echo -e "启动脚本: ${YELLOW}./$START_SCRIPT${NC}"
echo -e "${BLUE}======================================${NC}"