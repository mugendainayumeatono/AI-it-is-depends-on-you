async function processTTS(text, apiKey, voiceName) {
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
      chrome.runtime.sendMessage({ type: "play-audio-content", audioContent: data.audioContent });
    } else {
      throw new Error(data.error?.message || "Unknown TTS error");
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
}

async function processSTT(audioBase64, apiKey, sampleRate = 48000) {
  try {
    const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          encoding: "WEBM_OPUS",
          sampleRateHertz: sampleRate,
          languageCode: "en-US"
        },
        audio: {
          content: audioBase64
        }
      })
    });
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      return data.results[0].alternatives[0].transcript;
    } else {
      throw new Error("No speech recognized");
    }
  } catch (error) {
    console.error(error);
    throw error;
  }
}

function showStatus(msg, type = "") {
  const statusDiv = document.getElementById("status");
  if (!statusDiv) return;
  statusDiv.textContent = msg;
  statusDiv.style.color = type === "error" ? "red" : (type === "success" ? "green" : "black");
}

async function initPopup() {
  const apiKeyInput = document.getElementById("api-key");
  const saveKeyBtn = document.getElementById("save-key");
  const ttsText = document.getElementById("tts-text");
  const voiceSelect = document.getElementById("voice-select");
  const ttsBtn = document.getElementById("tts-btn");
  const recordBtn = document.getElementById("record-btn");
  const playRecordBtn = document.getElementById("play-record-btn");
  const sttBtn = document.getElementById("stt-btn");

  if (!apiKeyInput) return;

  const data = await chrome.storage.local.get(["apiKey", "preferredVoice"]);
  if (data.apiKey) apiKeyInput.value = data.apiKey;
  if (data.preferredVoice) voiceSelect.value = data.preferredVoice;

  saveKeyBtn.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    chrome.storage.local.set({ apiKey }, () => {
      showStatus("API Key saved!", "success");
    });
  });

  voiceSelect.addEventListener("change", () => {
    chrome.storage.local.set({ preferredVoice: voiceSelect.value });
  });

  ttsBtn.addEventListener("click", async () => {
    const text = ttsText.value.trim();
    if (!text) {
      showStatus("Please enter some text.", "error");
      return;
    }
    const { apiKey } = await chrome.storage.local.get("apiKey");
    if (!apiKey) {
      showStatus("Please save an API Key first.", "error");
      return;
    }
    showStatus("Generating speech...");
    try {
      await processTTS(text, apiKey, voiceSelect.value);
      showStatus("Playing...", "success");
    } catch (e) {
      showStatus("TTS Error: " + e.message, "error");
    }
  });

  recordBtn.addEventListener("mousedown", async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) return;
    recordBtn.classList.add("recording");
    recordBtn.textContent = "Recording...";
    chrome.runtime.sendMessage({ type: "start-capture", tabId: tabs[0].id });
  });

  const stopCapture = () => {
    if (!recordBtn.classList.contains("recording")) return;
    recordBtn.classList.remove("recording");
    recordBtn.textContent = "Hold to Record";
    chrome.runtime.sendMessage({ type: "stop-capture" });
  };

  recordBtn.addEventListener("mouseup", stopCapture);
  recordBtn.addEventListener("mouseleave", stopCapture);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "recording-stopped") {
      playRecordBtn.disabled = false;
      sttBtn.disabled = false;
      showStatus("Recording finished.", "success");
    }
  });

  playRecordBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "play-recorded-audio" });
  });

  sttBtn.addEventListener("click", async () => {
    const { apiKey } = await chrome.storage.local.get("apiKey");
    if (!apiKey) {
      showStatus("Please save an API Key first.", "error");
      return;
    }
    showStatus("Converting speech to text...");
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "get-recorded-content" }, resolve);
      });
      if (response && response.error) {
        showStatus(response.error, "error");
        return;
      }
      if (response && response.audioContent) {
        const text = await processSTT(response.audioContent, apiKey, response.sampleRate);
        ttsText.value = text;
        showStatus("Conversion successful!", "success");
      }
    } catch (error) {
      showStatus("STT failed: " + error.message, "error");
    }
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener("DOMContentLoaded", initPopup);
}

if (typeof module !== 'undefined') {
  module.exports = { initPopup, processTTS, processSTT, showStatus };
}
