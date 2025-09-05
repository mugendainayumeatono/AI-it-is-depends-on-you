import pytest
from unittest.mock import patch, MagicMock
import os
import asyncio
from flask import Flask
from botbuilder.core import BotFrameworkAdapter, BotFrameworkAdapterSettings

# Assuming app.py is in the root of the project or accessible via PYTHONPATH
from app import app, conversation_state, user_state, bot, settings, bot_adapter

# Fixture to provide a test client for the Flask app
@pytest.fixture
def client():
    app.config['TESTING'] = True
    with app.test_client() as client:
        yield client

def test_app_creation():
    """Test if the Flask app instance is created."""
    assert app is not None
    assert isinstance(app, Flask)

def test_state_initialization():
    """Test if conversation and user states are initialized."""
    assert conversation_state is not None
    assert user_state is not None

def test_bot_adapter_initialization():
    """Test if the BotFrameworkAdapter is initialized."""
    assert bot_adapter is not None
    assert isinstance(bot_adapter, BotFrameworkAdapter)

# Test the /api/messages POST endpoint
def test_messages_endpoint_post(client):
    """Test the /api/messages POST endpoint."""
    # Patch the 'process_activity' method of the bot_adapter instance in src.app
    with patch('botbuilder.core.bot_framework_adapter.BotFrameworkAdapter.process_activity') as mock_process_method:
        # For a sync test calling an async view, Flask's test client handles the loop.
        # We need the mock to be an awaitable, so we'll return a completed Future.
        future = asyncio.Future()
        future.set_result(None)
        mock_process_method.return_value = future

        # Prepare a mock request payload
        mock_payload = {
            "type": "message",
            "text": "Hello",
            "from": {"id": "user1"},
            "recipient": {"id": "bot1"},
            "conversation": {"id": "convo1"},
            "serviceUrl": "http://localhost"
        }
        
        # Make a POST request to the messages endpoint directly
        response = client.post('/api/messages', json=mock_payload)
        
        # Assert that the response status code is 200 OK
        assert response.status_code == 200
        
        # Assert that the 'process' method was called once
        mock_process_method.assert_called_once()

# Example of how to run tests:
# 1. Make sure you have pytest installed: pip install pytest pytest-asyncio
# 2. Run pytest from your terminal in the project root directory: pytest