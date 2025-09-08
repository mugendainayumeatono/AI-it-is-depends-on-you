#!/bin/bash

# 获取脚本所在的目录并跳转
cd "$(dirname "$0")"

# 从.env文件中读取ValidDomains和MicrosoftAppId
VALID_DOMAINS=$(grep -oP '(?<=ValidDomains=).*' .env)
MICROSOFT_APP_ID=$(grep -oP '(?<=MicrosoftAppId=).*' .env)

# 使用从.env读取的值更新manifest.json
# 为了更新json，创建一个临时文件
tmp=$(mktemp)

# 使用jq工具更新validDomains, id, 和 botId 字段
jq --arg new_domain "$VALID_DOMAINS" --arg app_id "$MICROSOFT_APP_ID" \
'.validDomains = [$new_domain] | .id = $app_id | .bots[0].botId = $app_id | .webApplicationInfo.id = $app_id' \
manifest.json > "$tmp" && mv "$tmp" manifest.json

echo "manifest.json has been successfully updated."

# 创建zip压缩包
zip -r manifest.zip manifest.json icon.png
