let mediaRecorder = null;
let audioChunks = [];
let currentAudio = null;

// Signal that the offscreen document is ready
chrome.runtime.sendMessage({ type: 'offscreen-ready', target: 'background' });
chrome.runtime.sendMessage({ type: 'offscreen-ready', target: 'popup' });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  if (message.type === 'play-audio') {
    playAudio(message.dataUrl, message.source, sendResponse);
    return true;
  }

  if (message.type === 'stop-audio') {
    stopAllAudio();
    sendResponse({ success: true });
  }

  if (message.type === 'start-recording') {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        sendResponse({ success: false, error: 'Recording already in progress' });
        return;
    }
    startRecording(message.streamId, sendResponse);
    return true;
  }

  if (message.type === 'stop-recording') {
    stopRecording(sendResponse);
    return true;
  }
});

function stopAllAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = ''; // Clear source to stop buffering
    currentAudio = null;
  }
}

async function playAudio(dataUrl, source, sendResponse) {
  if (!dataUrl) {
    sendResponse({ success: false, error: 'No dataUrl provided' });
    return;
  }
  try {
    stopAllAudio();
    currentAudio = new Audio(dataUrl);
    
    currentAudio.onended = () => {
      currentAudio = null;
      chrome.runtime.sendMessage({ type: 'audio-finished', source: source || 'unknown' });
    };

    currentAudio.onerror = (e) => {
      sendResponse({ success: false, error: 'Audio playback error' });
      chrome.runtime.sendMessage({ type: 'audio-finished', source: source || 'unknown' });
    };

    await currentAudio.play();
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

async function startRecording(streamId, sendResponse) {
  if (!streamId) {
    sendResponse({ success: false, error: 'No streamId provided' });
    return;
  }
  try {
    if (mediaRecorder) {
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      if (mediaRecorder.stream) {
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
      }
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    const audioCtx = new AudioContext();
    await audioCtx.resume();
    const source = audioCtx.createMediaStreamSource(stream);
    source.connect(audioCtx.destination);

    audioChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    
    mediaRecorder.onerror = (e) => {
      chrome.runtime.sendMessage({ type: 'audio-finished' }); // Cleanup UI
      console.error('MediaRecorder error:', e.error);
    };

    mediaRecorder.onstop = () => {
      // 1. Clean up resources
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close();
      }

      // 2. Process data
      try {
        if (audioChunks.length === 0) {
          sendResponse({ success: false, error: 'No audio data captured' });
          return;
        }
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          sendResponse({ success: true, dataUrl: reader.result });
          audioChunks = []; // Clear for next time
        };
        reader.onerror = () => sendResponse({ success: false, error: 'FileReader error' });
        reader.readAsDataURL(blob);
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    };

    mediaRecorder.start();
    sendResponse({ success: true });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

function stopRecording(sendResponse) {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    sendResponse({ success: false, error: 'No active recording found' });
    return;
  }
  // No need to set onstop here, it's already defined in startRecording
  mediaRecorder.stop();
}
