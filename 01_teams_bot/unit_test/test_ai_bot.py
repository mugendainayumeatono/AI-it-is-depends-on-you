import pytest
from unittest.mock import patch, MagicMock
from botbuilder.core import TurnContext
from botbuilder.schema import Activity, ChannelAccount

# Assuming ai_bot.py is in the src/bot directory
from bot.ai_bot import MyBot

# Mock the GeminiAIService and its get_ai_response method
@pytest.fixture
def mock_ai_service():
    with patch('bot.ai_bot.ai_service') as mock_service:
        # Make get_ai_response an async mock that returns an awaitable
        async def mock_get_ai_response(*args, **kwargs):
            return "Mocked AI Response"
        mock_service.get_ai_response.side_effect = mock_get_ai_response
        yield mock_service

# Mock TurnContext and its send_activity method
@pytest.fixture
def mock_turn_context():
    mock_context = MagicMock(spec=TurnContext)
    mock_context.activity = Activity(text="Test message")
    # Initialize recipient as a ChannelAccount mock
    mock_context.activity.recipient = ChannelAccount(id="mock_bot_id", name="Mock Bot")
    
    # Mock send_activity to be awaitable
    mock_send_activity = MagicMock()
    async def async_send_activity(*args, **kwargs):
        pass # Do nothing, just make it awaitable
    mock_send_activity.side_effect = async_send_activity
    mock_context.send_activity = mock_send_activity

    yield mock_context

def test_mybot_init(mock_ai_service, mock_turn_context):
    """Test if MyBot initializes correctly."""
    # Mock conversation_state and user_state as they are not directly tested here
    mock_conversation_state = MagicMock()
    mock_user_state = MagicMock()
    
    bot = MyBot(mock_conversation_state, mock_user_state)
    
    assert bot.conversation_state == mock_conversation_state
    assert bot.user_state == mock_user_state

@pytest.mark.asyncio
async def test_on_message_activity(mock_ai_service, mock_turn_context):
    """Test the on_message_activity method."""
    mock_conversation_state = MagicMock()
    mock_user_state = MagicMock()
    bot = MyBot(mock_conversation_state, mock_user_state)
    
    user_message = "Hello AI!"
    mock_turn_context.activity.text = user_message
    
    await bot.on_message_activity(mock_turn_context)
    
    # Assert that ai_service.get_ai_response was called with the user's message
    mock_ai_service.get_ai_response.assert_called_once_with(user_message)
    
    # Assert that send_activity was called with the AI's response
    expected_response = f"AI 回复: Mocked AI Response"
    mock_turn_context.send_activity.assert_called_once_with(expected_response)

@pytest.mark.asyncio
async def test_on_members_added_activity(mock_ai_service, mock_turn_context):
    """Test the on_members_added_activity method."""
    mock_conversation_state = MagicMock()
    mock_user_state = MagicMock()
    bot = MyBot(mock_conversation_state, mock_user_state)
    
    # Create a mock member that is not the recipient
    member1 = ChannelAccount(id="new_user_1", name="New User 1")
    # Create a mock member that IS the recipient (should be ignored)
    # Ensure its ID matches the mocked recipient ID in mock_turn_context
    recipient_member = ChannelAccount(id="mock_bot_id", name="Mock Bot")
    
    members_added = [member1, recipient_member]
    
    await bot.on_members_added_activity(members_added, mock_turn_context)
    
    # Assert that send_activity was called only once for the new member
    mock_turn_context.send_activity.assert_called_once_with("欢迎！我是您的 AI 助手。")

# Example of how to run tests:
# 1. Make sure you have pytest installed: pip install pytest pytest-asyncio
# 2. Run pytest from your terminal in the project root directory: pytest