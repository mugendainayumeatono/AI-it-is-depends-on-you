import os
import google.generativeai as genai
from botbuilder.core import TurnContext

class GeminiAIService:
    def __init__(self, config: dict):
        self.api_key = config.get("api_key")
        if not self.api_key:
            raise ValueError("Gemini API key is missing.")
        genai.configure(api_key=self.api_key)
        # You can specify the model name here, e.g., 'gemini-pro'
        self.model = genai.GenerativeModel('gemini-pro') 
        # Start a chat session with history
        self.chat = self.model.start_chat(history=[])

    async def get_ai_response(self, message: str) -> str:
        try:
            # Send message to Gemini API and get response
            response = self.chat.send_message(message)
            return response.text.strip()
        except Exception as e:
            print(f"Error calling Gemini API: {e}")
            # Return a user-friendly error message
            return "抱歉，我无法处理您的请求。"
