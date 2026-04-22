/**
 * @jest-environment node
 */
// global.chrome is set by setup.js
global.fetch = jest.fn();

describe('Background Script', () => {
  let bg;
  
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    chrome.storage.local.get.mockResolvedValue({ apiKey: 'key' });
    bg = require('../background.js');
  });

  test('comprehensive', async () => {
    const onMessage = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    
    // play-audio-content
    await onMessage({ type: 'play-audio-content', audioContent: 'abc' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'play-audio' }));

    // stop-capture
    onMessage({ type: 'stop-capture' });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'stop-recording' });

    // get-recorded-content
    const sendResponse = jest.fn();
    onMessage({ type: 'get-recorded-content' }, {}, sendResponse);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'get-recorded-audio' }, expect.any(Function));
    
    // get-recorded-content callback
    const getRecordedAudioCallback = chrome.runtime.sendMessage.mock.calls.find(c => c[0].type === 'get-recorded-audio')[1];
    getRecordedAudioCallback({ audioContent: 'blob' });
    expect(sendResponse).toHaveBeenCalledWith({ audioContent: 'blob' });

    // play-recorded-audio
    onMessage({ type: 'play-recorded-audio' });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'play-recorded' });
    
    // start-capture
    chrome.tabCapture = { getMediaStreamId: jest.fn((opts, cb) => cb('stream')) };
    await onMessage({ type: 'start-capture', tabId: 1 });
    expect(chrome.tabCapture.getMediaStreamId).toHaveBeenCalled();

    const onClicked = chrome.contextMenus.onClicked.addListener.mock.calls[0][0];
    global.fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue({ audioContent: 'abc' }) });
    await onClicked({ menuItemId: 'tts-selection', selectionText: 'test' });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(global.fetch).toHaveBeenCalled();

    const onInstalled = chrome.runtime.onInstalled.addListener.mock.calls[0][0];
    onInstalled();
    expect(chrome.contextMenus.create).toHaveBeenCalled();
  });

  test('processTTS missing API Key', async () => {
    chrome.storage.local.get.mockResolvedValueOnce({}); // apiKey missing
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    await bg.processTTS('test');
    expect(consoleSpy).toHaveBeenCalledWith('API Key not found');
    consoleSpy.mockRestore();
  });
  
  test('direct calls', async () => {
      bg.stopCapture();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'stop-recording' });
  });
});
