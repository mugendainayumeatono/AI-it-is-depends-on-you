import os
from dotenv import load_dotenv
from botbuilder.core import ConversationState, UserState
from botbuilder.core import BotFrameworkAdapter, BotFrameworkAdapterSettings
from flask import Flask, request

# 从本地 bot 目录导入机器人类
from bot.ai_bot import MyBot

load_dotenv() # 加载 .env 文件中的环境变量

APP_ID = os.environ.get("MicrosoftAppId")
APP_PASSWORD = os.environ.get("MicrosoftAppPassword")

# Flask 应用设置
app = Flask(__name__)

# 初始化状态管理器
# 注意：在实际应用中，应使用更持久化的状态存储
conversation_state = ConversationState(None)
user_state = UserState(None)

# 创建机器人实例
bot = MyBot(conversation_state, user_state)

# 配置 Bot Framework Adapter Settings
settings = BotFrameworkAdapterSettings(APP_ID, APP_PASSWORD)

# 配置 Bot Framework Flask Adapter
# BotFrameworkAdapter 构造函数只需要一个参数：settings
# bot 实例应该通过 on_turn 方法传递给 adapter
bot_adapter = BotFrameworkAdapter(settings)

# 定义消息处理路由
@app.route("/api/messages", methods=["POST"])
async def messages_endpoint():
    # 使用 await bot_adapter.process 而不是直接调用，因为 Flask 的 route 装饰器默认不支持 async
    # 需要一个异步运行器来处理 async 函数
    # import asyncio # Removed as asyncio.run is no longer needed
    await bot_adapter.process_activity(request, bot.on_turn)
    return {}, 200

if __name__ == "__main__":
    # 运行 Flask 开发服务器
    # 在生产环境中，应使用 Gunicorn 或 uWSGI
    # 端口可以根据需要更改，但 Teams 通常使用 3978
    app.run(host="0.0.0.0", port=3978)
