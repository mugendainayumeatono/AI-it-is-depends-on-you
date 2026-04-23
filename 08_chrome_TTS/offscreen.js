let mediaRecorder = null;
let audioChunks = [];
let currentAudio = null;
let pendingStopResponse = null;

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
      console.error('MediaRecorder error:', e.error);
      if (pendingStopResponse) {
        pendingStopResponse({ success: false, error: 'MediaRecorder error: ' + e.error });
        pendingStopResponse = null;
      }
      chrome.runtime.sendMessage({ type: 'audio-finished' }); // Cleanup UI
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
          if (pendingStopResponse) {
            pendingStopResponse({ success: false, error: 'No audio data captured' });
            pendingStopResponse = null;
          }
          return;
        }
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          if (pendingStopResponse) {
            pendingStopResponse({ success: true, dataUrl: reader.result });
            pendingStopResponse = null;
          }
          audioChunks = []; // Clear for next time
        };
        reader.onerror = () => {
          if (pendingStopResponse) {
            pendingStopResponse({ success: false, error: 'FileReader error' });
            pendingStopResponse = null;
          }
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        if (pendingStopResponse) {
          pendingStopResponse({ success: false, error: e.message });
          pendingStopResponse = null;
        }
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
  pendingStopResponse = sendResponse;
  mediaRecorder.stop();
}
