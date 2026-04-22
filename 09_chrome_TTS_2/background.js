'use strict';

/* ===== Context Menu Setup ===== */
chrome.runtime.onInstalled.addListener(() => {
  // Remove all first to avoid "duplicate id" errors on extension update.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'speak-selected-text',
      title: 'Speak Selected Text',
      contexts: ['selection'],
    });
  });
});

/* ===== Context Menu Click Handler ===== */
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'speak-selected-text') return;

  const selectedText = info.selectionText;
  if (!selectedText) return;

  // Retrieve API key from storage
  const { apiKey } = await chrome.storage.local.get(['apiKey']);
  if (!apiKey) {
    console.warn('[VoiceAssistant] No API key configured. Cannot speak selected text.');
    return;
  }

  // Get stored voice preferences
  const prefs = await chrome.storage.local.get(['selectedVoice', 'ttsSpeed', 'ttsPitch']);
  const voiceName = prefs.selectedVoice || '';
  const speed = parseFloat(prefs.ttsSpeed) || 1.0;
  const pitch = parseFloat(prefs.ttsPitch) || 0;

  // Determine language code from voice name or default
  // Google voice names can have 2-3 letter language codes (e.g. cmn-CN, yue-HK).
  let languageCode = 'en-US';
  if (voiceName) {
    const match = voiceName.match(/^([a-z]{2,3}-[A-Z]{2,4})/);
    if (match) languageCode = match[1];
  }

  const requestBody = {
    input: { text: selectedText },
    voice: voiceName
      ? { languageCode, name: voiceName }
      : { languageCode },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: speed,
      pitch,
    },
  };

  let base64Audio = null;
  try {
    const resp = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      }
    );

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const msg = errData?.error?.message || `HTTP ${resp.status}`;
      throw new Error(msg);
    }

    const data = await resp.json();
    base64Audio = data.audioContent;
    if (!base64Audio) throw new Error('No audio content returned.');
  } catch (err) {
    console.error('[VoiceAssistant] TTS API error:', err.message);
    return;
  }

  // Inject audio playback into the active tab
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectAudioPlayback,
      args: [base64Audio],
    });
  } catch (err) {
    console.error('[VoiceAssistant] Script injection error:', err.message);
  }
});

/**
 * Injected into the page to play TTS audio.
 * Must be a pure function (no closure references from service worker scope).
 * @param {string} base64Audio - Base64-encoded MP3 audio
 */
function injectAudioPlayback(base64Audio) {
  try {
    // Decode base64 to binary
    const binaryStr = atob(base64Audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);

    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
    });

    audio.addEventListener('error', (e) => {
      console.error('[VoiceAssistant] Audio playback error:', e);
      URL.revokeObjectURL(url);
    });

    audio.play().catch((err) => {
      console.error('[VoiceAssistant] play() rejected:', err);
    });
  } catch (err) {
    console.error('[VoiceAssistant] injectAudioPlayback error:', err);
  }
}

/* ===== Message Listener (for future popup <-> background communication) ===== */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ type: 'PONG' });
  }
  return false;
});
