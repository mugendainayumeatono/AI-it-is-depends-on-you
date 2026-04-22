/**
 * @jest-environment jsdom
 */
// global.chrome is set by setup.js
global.fetch = jest.fn();

describe('Popup UI Unit', () => {
  let popup;
  
  beforeEach(async () => {
    document.body.innerHTML = `
      <input id="api-key" type="password" />
      <button id="save-key">Save Key</button>
      <textarea id="tts-text"></textarea>
      <select id="voice-select">
        <option value="en-US-Wavenet-D">V1</option>
        <option value="zh-CN-Wavenet-A">V2</option>
      </select>
      <button id="tts-btn">TTS</button>
      <button id="record-btn">Hold to Record</button>
      <button id="play-record-btn" disabled>Play</button>
      <button id="stt-btn" disabled>STT</button>
      <div id="status"></div>
    `;
    
    jest.clearAllMocks();
    jest.resetModules();
    chrome.storage.local.get.mockResolvedValue({ apiKey: 'key' });
    chrome.tabs.query.mockResolvedValue([{ id: 1 }]);
    
    popup = require('../popup.js');
  });

  test('initPopup event binding coverage', async () => {
    await popup.initPopup();
    
    // Save Key (with callback)
    chrome.storage.local.set.mockImplementation((obj, cb) => cb && cb());
    document.getElementById('save-key').click();
    expect(document.getElementById('status').textContent).toBe('API Key saved!');

    // Record button mousedown
    const recordBtn = document.getElementById('record-btn');
    recordBtn.dispatchEvent(new MouseEvent('mousedown'));
    await new Promise(process.nextTick);
    expect(recordBtn.textContent).toBe('Recording...');

    // Mouseup
    recordBtn.dispatchEvent(new MouseEvent('mouseup'));
    expect(recordBtn.textContent).toBe('Hold to Record');

    // OnMessage listener
    const onMessage = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    onMessage({ type: 'recording-stopped' });
    expect(document.getElementById('play-record-btn').disabled).toBe(false);

    // Play button
    document.getElementById('play-record-btn').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'play-recorded-audio' });

    // STT button (Mock successful flow)
    chrome.runtime.sendMessage.mockImplementation((msg, resolve) => {
        if (msg.type === 'get-recorded-content') resolve({ audioContent: 'abc' });
    });
    global.fetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ results: [{ alternatives: [{ transcript: 'transcribed' }] }] })
    });
    await document.getElementById('stt-btn').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(document.getElementById('tts-text').value).toBe('transcribed');

    // voiceSelect change
    const voiceSelect = document.getElementById('voice-select');
    voiceSelect.value = 'zh-CN-Wavenet-A';
    voiceSelect.dispatchEvent(new Event('change'));
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ preferredVoice: 'zh-CN-Wavenet-A' });

    // recordBtn mouseleave
    recordBtn.classList.add('recording');
    recordBtn.dispatchEvent(new MouseEvent('mouseleave'));
    expect(recordBtn.classList.contains('recording')).toBe(false);
  });

  test('processTTS error handling', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: { message: 'TTS Failed' } })
    });
    await expect(popup.processTTS('hello', 'key', 'en-US-Wavenet-D')).rejects.toThrow('TTS Failed');
    
    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({})
    });
    await expect(popup.processTTS('hello', 'key', 'en-US-Wavenet-D')).rejects.toThrow('Unknown TTS error');

    global.fetch.mockRejectedValue(new Error('Network error'));
    await expect(popup.processTTS('hello', 'key', 'en-US-Wavenet-D')).rejects.toThrow('Network error');
  });

  test('processSTT error handling', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      json: jest.fn().mockResolvedValue({ error: { message: 'STT Failed' } })
    });
    await expect(popup.processSTT('abc', 'key')).rejects.toThrow('No speech recognized');

    global.fetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ results: [] })
    });
    await expect(popup.processSTT('abc', 'key')).rejects.toThrow('No speech recognized');

    global.fetch.mockRejectedValue(new Error('Network error'));
    await expect(popup.processSTT('abc', 'key')).rejects.toThrow('Network error');
  });

  test('ttsBtn edge cases', async () => {
    await popup.initPopup();
    const ttsBtn = document.getElementById('tts-btn');
    const ttsText = document.getElementById('tts-text');
    const status = document.getElementById('status');

    // Empty text
    ttsText.value = '';
    ttsBtn.click();
    expect(status.textContent).toBe('Please enter some text.');

    // Missing API Key
    ttsText.value = 'test';
    chrome.storage.local.get.mockResolvedValueOnce({});
    await ttsBtn.click();
    expect(status.textContent).toBe('Please save an API Key first.');

    // TTS Error
    chrome.storage.local.get.mockResolvedValue({ apiKey: 'key' });
    global.fetch.mockRejectedValue(new Error('TTS Error'));
    await ttsBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(status.textContent).toContain('TTS Error');
  });

  test('sttBtn missing API Key', async () => {
    await popup.initPopup();
    const sttBtn = document.getElementById('stt-btn');
    const status = document.getElementById('status');
    sttBtn.disabled = false; // Enable for test

    chrome.storage.local.get.mockResolvedValueOnce({});
    await sttBtn.click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(status.textContent).toBe('Please save an API Key first.');
    
    // STT Error
    chrome.storage.local.get.mockResolvedValue({ apiKey: 'key' });
    chrome.runtime.sendMessage.mockImplementation((msg, resolve) => {
        if (msg.type === 'get-recorded-content') resolve({ audioContent: 'abc' });
    });
    global.fetch.mockRejectedValue(new Error('STT Error'));
    await sttBtn.click();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(status.textContent).toContain('STT failed');
  });

  test('initPopup returns if apiKeyInput is missing', async () => {
    document.body.innerHTML = '<div></div>';
    const result = await popup.initPopup();
    expect(result).toBeUndefined();
  });
});
