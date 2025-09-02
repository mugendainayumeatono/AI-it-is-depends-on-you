
import os
from dotenv import load_dotenv
from botbuilder.core import ConversationState, UserState, TurnContext
from botbuilder.core.teams import TeamsActivityHandler
from botbuilder.schema import ChannelAccount
from botbuilder.integration.flask import FlaskAdapter
from flask import Flask, request

# 导入 AI 服务模块
from bot.ai_service import GeminiAIService # 假设 AI 服务实现已移至 bot/ai_service.py

load_dotenv() # 加载 .env 文件中的环境变量

APP_ID = os.environ.get("MicrosoftAppId")
APP_PASSWORD = os.environ.get("MicrosoftAppPassword")

# 初始化 AI 服务
# 确保 GEMINI_API_KEY 在 .env 文件中设置
ai_service = GeminiAIService({
    "api_key": os.environ.get("GEMINI_API_KEY")
    # 可以添加其他配置，如模型名称
})

class MyBot(TeamsActivityHandler):
    def __init__(self, conversation_state: ConversationState, user_state: UserState):
        super().__init__()
        self.conversation_state = conversation_state
        self.user_state = user_state

    async def on_message_activity(self, turn_context: TurnContext):
        user_message = turn_context.activity.text
        # 调用 AI 服务获取回复
        ai_response = await ai_service.get_ai_response(user_message)

        await turn_context.send_activity(f"AI 回复: {ai_response}")

    async def on_members_added_activity(self, members_added: ChannelAccount, turn_context: TurnContext):
        for member in members_added:
            if member.id != turn_context.activity.recipient.id:
                await turn_context.send_activity("欢迎！我是您的 AI 助手。")

# Flask 应用设置
app = Flask(__name__)

# 初始化状态管理器
# 注意：在实际应用中，应使用更持久化的状态存储
conversation_state = ConversationState(None)
user_state = UserState(None)

# 创建机器人实例
bot = MyBot(conversation_state, user_state)

# 配置 Bot Framework Flask Adapter
bot_adapter = FlaskAdapter(bot, APP_ID, APP_PASSWORD)

# 定义消息处理路由
@app.route("/api/messages", methods=["POST"])
async def messages_endpoint():
    return await bot_adapter.process(request, bot.on_turn)

if __name__ == "__main__":
    # 运行 Flask 开发服务器
    # 在生产环境中，应使用 Gunicorn 或 uWSGI
    # 端口可以根据需要更改，但 Teams 通常使用 3978
    app.run(host="0.0.0.0", port=3978) 
