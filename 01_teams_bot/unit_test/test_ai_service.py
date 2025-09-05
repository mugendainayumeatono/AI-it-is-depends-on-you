import pytest
from unittest.mock import patch, MagicMock
import os

# Assuming ai_service.py is in the src/bot directory
from bot.ai_service import GeminiAIService

# Mock the google.generativeai library
@pytest.fixture
def mock_genai():
    with patch('bot.ai_service.genai') as mock_genai_module:
        # Mock the GenerativeModel and its start_chat method
        mock_model = MagicMock()
        mock_chat = MagicMock()
        mock_model.start_chat.return_value = mock_chat
        mock_genai_module.GenerativeModel.return_value = mock_model
        yield mock_genai_module

def test_geminiai_service_init_success(mock_genai):
    """Test successful initialization of GeminiAIService."""
    api_key = "fake_api_key"
    config = {"api_key": api_key}
    
    service = GeminiAIService(config)
    
    # Assert that genai.configure was called with the correct API key
    mock_genai.configure.assert_called_once_with(api_key=api_key)
    
    # Assert that GenerativeModel was instantiated with the correct model
    mock_genai.GenerativeModel.assert_called_once_with('gemini-pro')
    
    # Assert that start_chat was called
    mock_genai.GenerativeModel.return_value.start_chat.assert_called_once_with(history=[])
    
    assert service.api_key == api_key
    assert service.model is not None
    assert service.chat is not None

def test_geminiai_service_init_missing_api_key(mock_genai):
    """Test initialization failure when API key is missing."""
    config = {}
    
    with pytest.raises(ValueError, match="Gemini API key is missing."):
        GeminiAIService(config)

    # Ensure genai.configure was not called if API key is missing
    mock_genai.configure.assert_not_called()

# Example of how to run tests:
# 1. Make sure you have pytest installed: pip install pytest
# 2. Run pytest from your terminal in the project root directory: pytest