
import os
from dotenv import load_dotenv
from botbuilder.core import ConversationState, UserState, TurnContext
from botbuilder.core.teams import TeamsActivityHandler
from botbuilder.schema import ChannelAccount

# 导入 AI 服务模块
from .ai_service import GeminiAIService # 使用相对导入

# 从 .env 文件加载环境变量
load_dotenv()

# 初始化 AI 服务
# 确保 GEMINI_API_KEY 在 .env 文件中设置
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
if not GEMINI_API_KEY:
    raise ValueError("Gemini API key is missing. Please set GEMINI_API_KEY in your .env file.")

ai_service = GeminiAIService({
    "api_key": GEMINI_API_KEY
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
