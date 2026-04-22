function initBackground() {
  chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
      id: "tts-selection",
      title: "TTS: Speak Selected Text",
      contexts: ["selection"]
    });
  });

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "tts-selection") {
      const text = info.selectionText;
      if (text) {
        processTTS(text);
      }
    }
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "start-capture") {
      startCapture(message.tabId);
    } else if (message.type === "stop-capture") {
      stopCapture();
    } else if (message.type === "play-recorded-audio") {
      chrome.runtime.sendMessage({ type: "play-recorded" });
    } else if (message.type === "get-recorded-content") {
      chrome.runtime.sendMessage({ type: "get-recorded-audio" }, (response) => {
        sendResponse(response);
      });
      return true; // Keep channel open
    } else if (message.type === "play-audio-content") {
      playAudio(message.audioContent);
    }
  });
}

initBackground();

// Export for tests
if (typeof module !== 'undefined') {
  module.exports = { initBackground, processTTS, playAudio, startCapture, stopCapture };
}

async function startCapture(tabId) {
  const streamId = await new Promise((resolve) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, resolve);
  });
  
  await setupOffscreenDocument("offscreen.html");
  chrome.runtime.sendMessage({ type: "start-recording", streamId });
}

function stopCapture() {
  chrome.runtime.sendMessage({ type: "stop-recording" });
}

async function processTTS(text) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) {
    console.error("API Key not found");
    return;
  }

  const { preferredVoice } = await chrome.storage.local.get("preferredVoice");
  const voiceName = preferredVoice || "en-US-Wavenet-D";
  const languageCode = voiceName.split("-").slice(0, 2).join("-");

  try {
    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: voiceName },
        audioConfig: { audioEncoding: "MP3" }
      })
    });

    const data = await response.json();
    if (data.audioContent) {
      playAudio(data.audioContent);
    } else {
      console.error("TTS API Error:", data);
    }
  } catch (error) {
    console.error("TTS Request failed:", error);
  }
}

async function playAudio(audioContent) {
  await setupOffscreenDocument("offscreen.html");
  chrome.runtime.sendMessage({
    type: "play-audio",
    audioContent: audioContent
  });
}

let offscreenSetupPromise = null;

async function setupOffscreenDocument(path) {
  if (offscreenSetupPromise) return offscreenSetupPromise;

  offscreenSetupPromise = (async () => {
    const offscreenUrl = chrome.runtime.getURL(path);
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });

    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: path,
        reasons: ["AUDIO_PLAYBACK", "USER_MEDIA"],
        justification: "Audio playback and recording"
      });
    }
  })().finally(() => {
    offscreenSetupPromise = null;
  });

  return offscreenSetupPromise;
}
