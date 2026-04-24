chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tts-selection",
    title: "Read selection with Cloud TTS",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "tts-stop",
    title: "Stop Reading",
    contexts: ["all"]
  });
});

let offscreenReadyPromise = null;
let resolveOffscreenReady = null;
let offscreenCreating = null;

chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'audio-finished' && message.source === 'background') {
    // Check if offscreen is still doing something else (like recording) before closing
    if (await chrome.offscreen.hasDocument()) {
      try {
        const status = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'get-status' });
        if (!status?.isRecording) {
          await chrome.offscreen.closeDocument();
          offscreenCreating = null;
          resolveOffscreenReady = null;
        }
      } catch (e) {
        // If message fails, document might be gone already or error occurred, just cleanup
        offscreenCreating = null;
        resolveOffscreenReady = null;
      }
    }
  } else if (message.type === 'offscreen-ready' && message.target === 'background') {
    if (resolveOffscreenReady) resolveOffscreenReady();
  }
});

async function requestTTS(text, apiKey, voice, lang, rate, pitch, effects) {
  // Clamp values to API limits: rate [0.25, 4.0], pitch [-20.0, 20.0]
  const clampedRate = Math.max(0.25, Math.min(4.0, parseFloat(rate) || 1.0));
  const clampedPitch = Math.max(-20.0, Math.min(20.0, parseFloat(pitch) || 0.0));

  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
    method: 'POST',
    body: JSON.stringify({
      input: { text },
      voice: { name: voice, languageCode: lang },
      audioConfig: { 
        audioEncoding: 'MP3',
        speakingRate: clampedRate,
        pitch: clampedPitch,
        effectsProfileId: effects || []
      }
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `HTTP error ${response.status}`);
  }
  return await response.json();
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "tts-selection") {
    const text = info.selectionText?.trim();
    if (!text) return;

    if (text.length > 5000) {
      showNotification('Text Too Long', 'Please select a text shorter than 5000 characters.');
      return;
    }

    const config = await chrome.storage.local.get([
      'apiKey', 'preferredVoice', 'preferredLang', 'rate', 'pitch', 'effects'
    ]);

    if (!config.apiKey) {
      showNotification('API Key Missing', 'Please set your API Key in settings.');
      return;
    }

    try {
      const data = await requestTTS(
        text, 
        config.apiKey, 
        config.preferredVoice || 'en-US-Wavenet-D', 
        config.preferredLang || 'en-US',
        config.rate,
        config.pitch,
        config.effects
      );
      if (data.audioContent) {
        await playAudioOffscreen(`data:audio/mp3;base64,${data.audioContent}`);
      }
    } catch (error) {
      showNotification('TTS Error', error.message);
    }
  } else if (info.menuItemId === "tts-stop") {
    closeOffscreenDocument();
  }
});

function showNotification(title, message) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: title,
    message: message
  });
}

async function closeOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    try { await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop-audio' }); } catch (e) {}
    await chrome.offscreen.closeDocument();
  }
  offscreenCreating = null;
  resolveOffscreenReady = null;
}

async function playAudioOffscreen(dataUrl) {
  try {
    await setupOffscreen(['AUDIO_PLAYBACK', 'USER_MEDIA'], 'Background TTS Playback');
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'play-audio', dataUrl: dataUrl, source: 'background' });
  } catch (err) {
    console.error('Offscreen playback error:', err);
    showNotification('Playback Error', err.message);
  }
}

async function setupOffscreen(reasons, justification) {
  if (await chrome.offscreen.hasDocument()) return;
  if (offscreenCreating) return offscreenCreating;

  offscreenCreating = new Promise(async (resolve, reject) => {
    try {
      offscreenReadyPromise = new Promise((res, rej) => {
        resolveOffscreenReady = res;
        setTimeout(() => {
          resolveOffscreenReady = null;
          rej(new Error('Timeout'));
        }, 5000);
      });
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: reasons,
        justification: justification
      });
      await offscreenReadyPromise;
      resolve();
    } catch (err) {
      resolveOffscreenReady = null;
      reject(err);
    } finally {
      offscreenCreating = null;
    }
  });
  return offscreenCreating;
}
