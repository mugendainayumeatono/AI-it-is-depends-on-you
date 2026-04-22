/**
 * @jest-environment node
 */
// global.chrome is set by setup.js

// Mock global fetch
global.fetch = jest.fn();

describe('Offscreen Script', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    
    // Mock MediaRecorder and Audio
    global.MediaRecorder = jest.fn().mockImplementation(() => ({
      start: jest.fn(function() { this.state = 'recording'; }),
      stop: jest.fn(function() { this.state = 'inactive'; }),
      state: 'inactive',
      ondataavailable: null,
      onstop: null,
      stream: { getTracks: () => [{ stop: jest.fn() }] }
    }));
    global.MediaRecorder.isTypeSupported = jest.fn().mockReturnValue(true);

    global.Audio = jest.fn().mockImplementation(() => ({
      play: jest.fn(),
      pause: jest.fn(),
      onended: null
    }));

    global.AudioContext = jest.fn().mockImplementation(() => ({
      createMediaStreamSource: jest.fn().mockReturnValue({ connect: jest.fn() }),
      destination: {},
      sampleRate: 48000,
      close: jest.fn()
    }));

    global.URL.createObjectURL = jest.fn().mockReturnValue('blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    global.FileReader = jest.fn().mockImplementation(() => ({
      readAsDataURL: function(blob) {
        this.result = 'data:audio/webm;base64,testdata';
        if (this.onloadend) this.onloadend();
      }
    }));
    
    if (!global.navigator) global.navigator = {};
    Object.defineProperty(global.navigator, 'mediaDevices', {
      value: {
        getUserMedia: jest.fn().mockResolvedValue({ getTracks: () => [] })
      },
      configurable: true
    });

    require('../offscreen.js');
  });

  test('full recording flow', async () => {
    const onMessageListener = chrome.runtime.onMessage.addListener.mock.calls.find(call => typeof call[0] === 'function')[0];
    
    // Start — listener fires startRecording() without await, flush microtasks first
    onMessageListener({ type: 'start-recording', streamId: '1' });
    await new Promise(resolve => setTimeout(resolve, 0));
    const recorderInstance = global.MediaRecorder.mock.results[0].value;
    expect(recorderInstance.state).toBe('recording');

    // Stop
    onMessageListener({ type: 'stop-recording' });
    expect(recorderInstance.stop).toHaveBeenCalled();
    
    // Simulate stop event
    recorderInstance.onstop();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'recording-stopped', sampleRate: 48000 });

    // Play recorded
    onMessageListener({ type: 'play-recorded' });
    expect(global.Audio).toHaveBeenCalled();

    // Get recorded audio
    const sendResponse = jest.fn();
    onMessageListener({ type: 'get-recorded-audio' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ audioContent: 'testdata', sampleRate: 48000 });
  });
});
