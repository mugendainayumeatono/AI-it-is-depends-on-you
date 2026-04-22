# Chrome TTS & STT Tool

This extension provides Text-to-Speech (TTS) and Speech-to-Text (STT) capabilities using Google Cloud APIs.

## Features
- **TTS**: Enter text in the popup or select text on any webpage (right-click) to hear it spoken.
- **STT**: Record audio from the current tab by holding the "Record" button and convert it to text.
- **Voice Selection**: Choose between different voices and languages.
- **Secure API Key Storage**: Your Google Cloud API key is stored locally and securely.

## Setup
1. Get a Google Cloud API Key with "Cloud Text-to-Speech API" and "Cloud Speech-to-Text API" enabled.
2. Open the extension popup, click "API Settings", enter your key, and click "Save Key".
3. Select your preferred voice.

## Usage
### Text to Speech
- **In Popup**: Type text in the textarea and click "Generate & Play".
- **On Webpage**: Highlight any text, right-click, and select "TTS: Speak Selected Text".

### Speech to Text
1. Click and hold the "Hold to Record" button. It will capture the audio playing in the current tab.
2. Release the button to stop recording.
3. (Optional) Click "Play Recording" to hear what was captured.
4. Click "Convert to Text" to use Google Cloud STT to transcribe the audio into the textarea.

## Installation
1. Go to `chrome://extensions/`.
2. Enable "Developer mode".
3. Click "Load unpacked" and select this project directory.
