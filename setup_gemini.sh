#!/bin/bash

# ==========================================
# Google Gemini CLI 增强安装脚本
# 1. 自动检测并安装 Node.js/npm (交互式)
# 2. 安装 @google/gemini-cli
# 3. 创建环境变量文件
# 4. 创建 Flash 模型专用启动脚本
# ==========================================

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== Gemini CLI 环境一键配置 ===${NC}"

# -----------------------------------------------------------
# 1. 环境检查与 Node.js/npm 安装
# -----------------------------------------------------------
if ! command -v npm &> /dev/null; then
	    echo -e "${YELLOW}检测到系统中未安装 npm。${NC}"
	        read -p "是否现在安装 Node.js 和 npm? (y/n): " confirm
		    if [[ $confirm == [yY] || $confirm == [yY][eE][sS] ]]; then
			            echo -e "${BLUE}正在尝试安装环境...${NC}"
				            
				            # 根据操作系统判断安装方式
					            if [[ "$OSTYPE" == "linux-gnu"* ]]; then
							                if command -v apt &> /dev/null; then
										                sudo apt update && sudo apt install -y nodejs npm
												            elif command -v yum &> /dev/null; then
														                    sudo yum install -y nodejs npm
																                else
																			                echo -e "${RED}未找到支持的包管理器 (apt/yum)，请手动安装 Node.js。${NC}"
																					                exit 1
																							            fi
																								            elif [[ "$OSTYPE" == "darwin"* ]]; then
																										                if command -v brew &> /dev/null; then
																													                brew install node
																															            else
																																	                    echo -e "${RED}未找到 Homebrew，请访问 https://nodejs.org 安装。${NC}"
																																			                    exit 1
																																					                fi
																																							        fi
																																								    else
																																									            echo -e "${RED}由于缺少 npm，安装无法继续。${NC}"
																																										            exit 1
																																											        fi
fi

# 再次确认 npm 是否安装成功
if ! command -v npm &> /dev/null; then
	    echo -e "${RED}npm 安装失败，请手动检查环境。${NC}"
	        exit 1
fi

echo -e "${GREEN}npm 环境就绪: $(npm -v)${NC}"

# -----------------------------------------------------------
# 2. 安装 @google/gemini-cli
# -----------------------------------------------------------
echo -e "${GREEN}[步骤 1/3] 正在全局安装 @google/gemini-cli...${NC}"
# 使用 sudo 以确保全局安装权限
sudo npm install -g @google/gemini-cli

if [ $? -ne 0 ]; then
	    echo -e "${RED}CLI 安装失败，请检查网络或 npm 配置。${NC}"
	        exit 1
fi

# -----------------------------------------------------------
# 3. 创建环境变量文件
# -----------------------------------------------------------
echo -e "${GREEN}[步骤 2/3] 配置 API 密钥...${NC}"
ENV_FILE=".gemini_env"

read -p "请输入你的 Gemini API Key: " USER_KEY
if [ -z "$USER_KEY" ]; then
	    USER_KEY="YOUR_API_KEY_HERE"
	        echo -e "${YELLOW}未输入 Key，已设为占位符。${NC}"
fi

# 写入配置文件
cat << EOF > $ENV_FILE
# Gemini API Key 配置
export GEMINI_API_KEY="$USER_KEY"
EOF
chmod 600 $ENV_FILE
echo -e "配置文件已创建: ${BLUE}$ENV_FILE${NC}"

# -----------------------------------------------------------
# 4. 创建启动脚本 (指定使用 Flash 模型)
# -----------------------------------------------------------
echo -e "${GREEN}[步骤 3/3] 生成 Flash 启动脚本...${NC}"
START_SCRIPT="gemini-flash.sh"

cat << EOF > $START_SCRIPT
#!/bin/bash

# 获取当前脚本所在绝对路径
DIR="\$( cd "\$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"

# 1. 载入 API Key
if [ -f "\$DIR/$ENV_FILE" ]; then
	    source "\$DIR/$ENV_FILE"
    else
	        echo "错误: 找不到配置文件 $ENV_FILE"
    exit 1
fi

# 2. 调用 CLI
# 使用 --model 参数指定 gemini-1.5-flash
# "\$@" 用于接收外部传入的所有参数（如：./gemini-flash.sh "你好"）
gemini --model gemini-1.5-flash "\$@"
EOF

chmod +x $START_SCRIPT

# -----------------------------------------------------------
# 结束提示
# -----------------------------------------------------------
echo -e "\n${BLUE}======================================${NC}"
echo -e "${GREEN}恭喜！安装及配置全部完成。${NC}"
echo -e "你可以通过以下方式使用 Flash 模型："
echo -e "${YELLOW}./$START_SCRIPT \"请解释一下什么是黑洞\"${NC}"
echo -e "${BLUE}======================================${NC}"
