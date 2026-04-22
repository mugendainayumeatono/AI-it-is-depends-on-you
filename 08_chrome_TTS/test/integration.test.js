/**
 * @jest-environment jsdom
 */
const { chrome } = require('jest-chrome');
global.fetch = jest.fn();

describe('Integration Flow', () => {
  let bg, popup, offscreen;

  beforeEach(() => {
    document.body.innerHTML = `
      <input id="api-key" type="password" />
      <button id="save-key">Save Key</button>
      <textarea id="tts-text"></textarea>
      <select id="voice-select"><option value="en-US-Wavenet-D">V1</option></select>
      <button id="tts-btn">TTS</button>
      <button id="record-btn">Hold to Record</button>
      <button id="play-record-btn" disabled>Play</button>
      <button id="stt-btn" disabled>STT</button>
      <div id="status"></div>
    `;

    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock for offscreen
    if (!global.navigator) global.navigator = {};
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: { getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [] }) },
      configurable: true
    });
    global.Audio = jest.fn().mockImplementation(() => ({ play: jest.fn() }));
    global.MediaRecorder = jest.fn().mockImplementation(() => ({
      start: jest.fn(),
      stop: jest.fn(),
      state: 'inactive',
      stream: { getTracks: () => [] }
    }));

    chrome.storage.local.get.mockResolvedValue({ apiKey: 'key' });
    chrome.runtime.getContexts.mockResolvedValue([]);

    bg = require('../background.js');
    popup = require('../popup.js');
    offscreen = require('../offscreen.js');

    // Manually trigger init
    popup.initPopup();
  });

  test('TTS from popup to playback', async () => {
    const ttsBtn = document.getElementById('tts-btn');
    const ttsText = document.getElementById('tts-text');
    ttsText.value = 'hello';

    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ audioContent: 'base64audio' })
    });

    // Capture background and offscreen listeners
    const bgListener = chrome.runtime.onMessage.addListener.mock.calls.find(c => c[0].name === '')[0]; // anonymous usually
    // Or just simulate the calls
    
    await ttsBtn.click();
    await new Promise(process.nextTick);

    expect(global.fetch).toHaveBeenCalled();
    // In background.js, playAudio is called
    // We can verify sendMessage was called with play-audio-content
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'play-audio-content' }));
  });
});
