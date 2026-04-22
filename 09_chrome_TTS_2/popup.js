'use strict';

/* ===== Constants ===== */
const API_BASE_TTS = 'https://texttospeech.googleapis.com/v1';
const API_BASE_STT = 'https://speech.googleapis.com/v1';

/* ===== State ===== */
let apiKey = '';
let currentAudioSource = null;
let currentAudioUrl = null;
let mediaRecorder = null;
let recordedBlob = null;
let recordingTimer = null;
let recordingSeconds = 0;
let tabStream = null;
let playbackAudio = null;
let playbackUrl = null;
let isRecording = false;

/* ===== DOM Ready ===== */
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupTabs();
  setupTTSPanel();
  setupSTTPanel();
  setupSettingsPanel();

  // Load voices after settings are ready
  if (apiKey) {
    await loadVoices();
  }
});

/* ===== Settings ===== */
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      ['apiKey', 'selectedVoice', 'ttsSpeed', 'ttsPitch'],
      (data) => {
        apiKey = data.apiKey || '';

        const apiInput = document.getElementById('api-key-input');
        if (apiInput) apiInput.value = apiKey;

        const speedSlider = document.getElementById('speed-slider');
        const speedValue = document.getElementById('speed-value');
        if (speedSlider && data.ttsSpeed !== undefined) {
          speedSlider.value = data.ttsSpeed;
          if (speedValue) speedValue.textContent = `${parseFloat(data.ttsSpeed).toFixed(2)}x`;
        }

        const pitchSlider = document.getElementById('pitch-slider');
        const pitchValue = document.getElementById('pitch-value');
        if (pitchSlider && data.ttsPitch !== undefined) {
          pitchSlider.value = data.ttsPitch;
          if (pitchValue) pitchValue.textContent = parseFloat(data.ttsPitch).toFixed(0);
        }

        resolve();
      }
    );
  });
}

/* ===== Tab Navigation ===== */
function setupTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;

      tabBtns.forEach((b) => b.classList.remove('active'));
      panels.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const panel = document.getElementById(`panel-${target}`);
      if (panel) panel.classList.add('active');
    });
  });
}

/* ===== TTS Panel ===== */
function setupTTSPanel() {
  const textarea = document.getElementById('tts-text');
  const charCounter = document.getElementById('char-counter');
  const speedSlider = document.getElementById('speed-slider');
  const speedValue = document.getElementById('speed-value');
  const pitchSlider = document.getElementById('pitch-slider');
  const pitchValue = document.getElementById('pitch-value');
  const voiceSelect = document.getElementById('voice-select');
  const speakBtn = document.getElementById('speak-btn');
  const stopBtn = document.getElementById('stop-btn');
  const clearBtn = document.getElementById('clear-btn');

  // Persist voice selection (registered once here, not inside loadVoices)
  voiceSelect.addEventListener('change', () => {
    chrome.storage.local.set({ selectedVoice: voiceSelect.value });
  });

  // Char counter
  textarea.addEventListener('input', () => {
    const len = textarea.value.length;
    charCounter.textContent = `${len} / 5000`;
    charCounter.classList.toggle('near-limit', len > 4500);
  });

  // Speed slider
  speedSlider.addEventListener('input', () => {
    const val = parseFloat(speedSlider.value).toFixed(2);
    speedValue.textContent = `${val}x`;
    chrome.storage.local.set({ ttsSpeed: speedSlider.value });
  });

  // Pitch slider
  pitchSlider.addEventListener('input', () => {
    const val = parseFloat(pitchSlider.value).toFixed(0);
    pitchValue.textContent = val;
    chrome.storage.local.set({ ttsPitch: pitchSlider.value });
  });

  // Speak
  speakBtn.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) {
      showStatus('tts-status', 'Please enter some text to speak.', 'error');
      return;
    }
    if (!apiKey) {
      showStatus('tts-status', 'No API key set. Please configure it in Settings.', 'error');
      return;
    }
    await speakText(text);
  });

  // Stop
  stopBtn.addEventListener('click', () => {
    stopSpeaking();
  });

  // Clear
  clearBtn.addEventListener('click', () => {
    textarea.value = '';
    charCounter.textContent = '0 / 5000';
    charCounter.classList.remove('near-limit');
    hideStatus('tts-status');
    stopSpeaking();
  });
}

/* ===== Load Voices ===== */
async function loadVoices() {
  const voiceSelect = document.getElementById('voice-select');
  if (!voiceSelect) return;

  if (!apiKey) {
    voiceSelect.innerHTML = '<option value="">— Set API key in Settings —</option>';
    return;
  }

  showStatus('tts-status', 'Loading voices...', 'loading');

  try {
    const resp = await fetch(`${API_BASE_TTS}/voices?key=${encodeURIComponent(apiKey)}`);
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const msg = errData?.error?.message || `HTTP ${resp.status}`;
      throw new Error(msg);
    }
    const data = await resp.json();
    const voices = data.voices || [];

    // Sort: by language, then name
    voices.sort((a, b) => {
      const la = (a.languageCodes?.[0] || '').localeCompare(b.languageCodes?.[0] || '');
      if (la !== 0) return la;
      return a.name.localeCompare(b.name);
    });

    // Group by language
    const groups = {};
    for (const voice of voices) {
      const lang = voice.languageCodes?.[0] || 'Unknown';
      if (!groups[lang]) groups[lang] = [];
      groups[lang].push(voice);
    }

    voiceSelect.innerHTML = '<option value="">— Select a voice —</option>';

    for (const lang of Object.keys(groups).sort()) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = lang;
      for (const voice of groups[lang]) {
        const genderEmoji = voice.ssmlGender === 'FEMALE' ? '♀' : voice.ssmlGender === 'MALE' ? '♂' : '◉';
        const opt = document.createElement('option');
        opt.value = voice.name;
        opt.textContent = `${genderEmoji} ${voice.name}`;
        optgroup.appendChild(opt);
      }
      voiceSelect.appendChild(optgroup);
    }

    // Restore saved voice
    chrome.storage.local.get(['selectedVoice'], (data) => {
      if (data.selectedVoice) {
        voiceSelect.value = data.selectedVoice;
      }
    });

    hideStatus('tts-status');
  } catch (err) {
    showStatus('tts-status', `Failed to load voices: ${err.message}`, 'error');
  }
}

/* ===== TTS: Speak ===== */
async function speakText(text) {
  const voiceSelect = document.getElementById('voice-select');
  const speedSlider = document.getElementById('speed-slider');
  const pitchSlider = document.getElementById('pitch-slider');
  const speakBtn = document.getElementById('speak-btn');
  const stopBtn = document.getElementById('stop-btn');

  const voiceName = voiceSelect.value;
  const speed = parseFloat(speedSlider.value);
  const pitch = parseFloat(pitchSlider.value);

  // Determine language from voice or default
  // Google voice names: "en-US-Wavenet-A", "cmn-CN-Wavenet-B", "yue-HK-Standard-A"
  // Language codes can be 2 or 3 letters (BCP-47), region codes 2-4 letters.
  let languageCode = 'en-US';
  if (voiceName) {
    const match = voiceName.match(/^([a-z]{2,3}-[A-Z]{2,4})/);
    if (match) languageCode = match[1];
  }

  const body = {
    input: { text },
    voice: voiceName
      ? { languageCode, name: voiceName }
      : { languageCode },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: speed,
      pitch,
    },
  };

  showStatus('tts-status', 'Generating speech...', 'loading');
  speakBtn.disabled = true;

  try {
    const resp = await fetch(`${API_BASE_TTS}/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const msg = errData?.error?.message || `HTTP ${resp.status}`;
      throw new Error(msg);
    }

    const data = await resp.json();
    const base64Audio = data.audioContent;

    if (!base64Audio) throw new Error('No audio content returned from API.');

    // Decode base64 → binary
    const binaryStr = atob(base64Audio);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });
    const audioUrl = URL.createObjectURL(audioBlob);

    // Stop any current playback (revokes old URL, re-enables speakBtn)
    stopSpeaking();

    currentAudioUrl = audioUrl;
    currentAudioSource = new Audio(audioUrl);
    currentAudioSource.addEventListener('ended', () => {
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = null;
      }
      currentAudioSource = null;
      stopBtn.disabled = true;
      speakBtn.disabled = false;
      showStatus('tts-status', 'Playback complete.', 'success');
    });
    currentAudioSource.addEventListener('error', () => {
      if (currentAudioUrl) {
        URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = null;
      }
      currentAudioSource = null;
      stopBtn.disabled = true;
      speakBtn.disabled = false;
      showStatus('tts-status', 'Audio playback error.', 'error');
    });

    await currentAudioSource.play();
    stopBtn.disabled = false;
    // speakBtn stays disabled during playback to prevent concurrent fetches.
    // It is re-enabled only by the ended/error handlers or stopSpeaking().
    showStatus('tts-status', 'Playing...', 'success');
  } catch (err) {
    showStatus('tts-status', `TTS error: ${err.message}`, 'error');
    speakBtn.disabled = false;
    stopBtn.disabled = true;
  }
}

/* ===== TTS: Stop ===== */
function stopSpeaking() {
  if (currentAudioSource) {
    currentAudioSource.pause();
    currentAudioSource.currentTime = 0;
    currentAudioSource = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = null;
  }
  const speakBtn = document.getElementById('speak-btn');
  const stopBtn = document.getElementById('stop-btn');
  if (speakBtn) speakBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  hideStatus('tts-status');
}

/* ===== STT Panel ===== */
function setupSTTPanel() {
  const recordBtn = document.getElementById('record-btn');
  const copyBtn = document.getElementById('copy-btn');
  const sttResult = document.getElementById('stt-result');

  // ---- Hold-to-Record (mouse) ----
  recordBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startRecording();
  });

  recordBtn.addEventListener('mouseup', () => {
    if (isRecording) stopRecording();
  });

  recordBtn.addEventListener('mouseleave', () => {
    if (isRecording) stopRecording();
  });

  // ---- Hold-to-Record (touch) ----
  recordBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startRecording();
  });

  recordBtn.addEventListener('touchend', (e) => {
    e.preventDefault();
    if (isRecording) stopRecording();
  });

  recordBtn.addEventListener('touchcancel', () => {
    if (isRecording) stopRecording();
  });

  // ---- Playback ----
  playBtn.addEventListener('click', () => playRecording());
  stopPlaybackBtn.addEventListener('click', () => stopPlayback());

  // ---- Convert ----
  convertBtn.addEventListener('click', () => convertToText());

  // ---- Copy ----
  copyBtn.addEventListener('click', async () => {
    const text = sttResult.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showStatus('stt-status', 'Copied to clipboard!', 'success');
      setTimeout(() => hideStatus('stt-status'), 2000);
    } catch {
      // Fallback
      sttResult.select();
      document.execCommand('copy');
      showStatus('stt-status', 'Copied!', 'success');
      setTimeout(() => hideStatus('stt-status'), 2000);
    }
  });
}

/* ===== STT: Start Recording ===== */
async function startRecording() {
  if (isRecording) return;

  const sourceRadio = document.querySelector('input[name="audio-source"]:checked');
  const source = sourceRadio ? sourceRadio.value : 'microphone';

  hideStatus('stt-record-status');

  let stream = null;
  try {
    if (source === 'tab') {
      // Tab audio via tabCapture
      stream = await new Promise((resolve, reject) => {
        chrome.tabCapture.capture({ audio: true, video: false }, (capturedStream) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!capturedStream) {
            reject(new Error('Could not capture tab audio. Make sure a tab is active.'));
          } else {
            resolve(capturedStream);
          }
        });
      });
      tabStream = stream;
    } else {
      // Microphone
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    recordedBlob = null;

    // Hide old playback section and clear previous transcript
    document.getElementById('playback-section').classList.add('hidden');
    document.getElementById('convert-btn').disabled = true;
    document.getElementById('stt-result').value = '';
    document.getElementById('copy-btn').classList.add('hidden');

    // Pick best supported MIME type
    const mimeType = getSupportedMimeType();
    const options = mimeType ? { mimeType } : {};

    // Use a session-local array so a rapid stop→start cycle cannot clobber
    // this session's chunks before the 'stop' event fires.
    const sessionChunks = [];
    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) {
        sessionChunks.push(e.data);
      }
    });

    mediaRecorder.addEventListener('stop', () => {
      // Build blob from session-local chunks (safe against rapid re-record).
      const usedMime = mediaRecorder.mimeType || 'audio/webm';
      recordedBlob = new Blob(sessionChunks, { type: usedMime });

      // Stop stream tracks (use stream directly; tabStream is the same object for tab capture)
      stream.getTracks().forEach((t) => t.stop());
      tabStream = null;

      // Show playback section
      document.getElementById('playback-section').classList.remove('hidden');
      document.getElementById('play-btn').disabled = false;
      document.getElementById('stop-playback-btn').disabled = true;
      document.getElementById('convert-btn').disabled = false;

      // Update UI
      setRecordingUI(false);
    });

    mediaRecorder.start(100); // collect data every 100ms
    isRecording = true;
    setRecordingUI(true);
    startTimer();

  } catch (err) {
    // Release stream if it was acquired before the error
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    tabStream = null;
    showStatus('stt-record-status', `Could not start recording: ${err.message}`, 'error');
    isRecording = false;
    setRecordingUI(false);
  }
}

/* ===== STT: Stop Recording ===== */
function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;
  stopTimer();

  if (mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

/* ===== STT: Set UI State ===== */
function setRecordingUI(recording) {
  const recordBtn = document.getElementById('record-btn');
  const recordLabel = document.getElementById('record-label');
  const waveViz = document.getElementById('wave-visualizer');
  const timerDisplay = document.getElementById('timer-display');

  if (recording) {
    recordBtn.classList.add('recording');
    recordLabel.textContent = 'Recording... (release to stop)';
    waveViz.classList.add('active');
    timerDisplay.classList.add('active');
  } else {
    recordBtn.classList.remove('recording');
    recordLabel.textContent = 'Hold to Record';
    waveViz.classList.remove('active');
    timerDisplay.classList.remove('active');
  }
}

/* ===== Timer ===== */
function startTimer() {
  recordingSeconds = 0;
  updateTimerDisplay();
  recordingTimer = setInterval(() => {
    recordingSeconds++;
    updateTimerDisplay();
  }, 1000);
}

function stopTimer() {
  if (recordingTimer) {
    clearInterval(recordingTimer);
    recordingTimer = null;
  }
}

function updateTimerDisplay() {
  const mins = String(Math.floor(recordingSeconds / 60)).padStart(2, '0');
  const secs = String(recordingSeconds % 60).padStart(2, '0');
  const display = document.getElementById('timer-display');
  if (display) display.textContent = `${mins}:${secs}`;
}

/* ===== STT: Playback ===== */
function playRecording() {
  if (!recordedBlob) return;

  stopPlayback();

  playbackUrl = URL.createObjectURL(recordedBlob);
  playbackAudio = new Audio(playbackUrl);

  const playBtn = document.getElementById('play-btn');
  const stopPlaybackBtn = document.getElementById('stop-playback-btn');

  playBtn.disabled = true;
  stopPlaybackBtn.disabled = false;

  playbackAudio.addEventListener('ended', () => {
    playBtn.disabled = false;
    stopPlaybackBtn.disabled = true;
    if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
    playbackAudio = null;
  });

  playbackAudio.addEventListener('error', () => {
    playBtn.disabled = false;
    stopPlaybackBtn.disabled = true;
    if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
    playbackAudio = null;
    showStatus('stt-record-status', 'Playback error.', 'error');
  });

  playbackAudio.play().catch((err) => {
    if (playbackUrl) { URL.revokeObjectURL(playbackUrl); playbackUrl = null; }
    playbackAudio = null;
    showStatus('stt-record-status', `Playback failed: ${err.message}`, 'error');
    playBtn.disabled = false;
    stopPlaybackBtn.disabled = true;
  });
}

function stopPlayback() {
  if (playbackAudio) {
    playbackAudio.pause();
    playbackAudio.currentTime = 0;
    playbackAudio = null;
  }
  if (playbackUrl) {
    URL.revokeObjectURL(playbackUrl);
    playbackUrl = null;
  }
  const playBtn = document.getElementById('play-btn');
  const stopPlaybackBtn = document.getElementById('stop-playback-btn');
  if (playBtn) playBtn.disabled = false;
  if (stopPlaybackBtn) stopPlaybackBtn.disabled = true;
}

/* ===== STT: Convert to Text ===== */
async function convertToText() {
  if (!recordedBlob) {
    showStatus('stt-status', 'No recording found. Please record audio first.', 'error');
    return;
  }

  if (!apiKey) {
    showStatus('stt-status', 'No API key set. Please configure it in Settings.', 'error');
    return;
  }

  const langSelect = document.getElementById('stt-language');
  const language = langSelect ? langSelect.value : 'en-US';
  const convertBtn = document.getElementById('convert-btn');

  convertBtn.disabled = true;
  showStatus('stt-status', 'Converting speech to text...', 'loading');

  try {
    const base64Audio = await blobToBase64(recordedBlob);

    // Determine encoding from MIME type
    const mimeType = recordedBlob.type || 'audio/webm';
    let encoding = 'WEBM_OPUS';
    let sampleRateHertz = 48000;

    if (mimeType.includes('ogg')) {
      encoding = 'OGG_OPUS';
    } else if (mimeType.includes('mp4') || mimeType.includes('aac')) {
      encoding = 'MP3';
      sampleRateHertz = 44100;
    }

    const body = {
      config: {
        encoding,
        sampleRateHertz,
        languageCode: language,
        enableAutomaticPunctuation: true,
        model: 'latest_short',
      },
      audio: {
        content: base64Audio,
      },
    };

    const resp = await fetch(`${API_BASE_STT}/speech:recognize?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const msg = errData?.error?.message || `HTTP ${resp.status}`;
      throw new Error(msg);
    }

    const data = await resp.json();
    const results = data.results || [];

    let transcript = '';
    for (const result of results) {
      const alt = result.alternatives?.[0];
      if (alt?.transcript) {
        transcript += alt.transcript + ' ';
      }
    }
    transcript = transcript.trim();

    const sttResult = document.getElementById('stt-result');
    const copyBtn = document.getElementById('copy-btn');

    if (transcript) {
      sttResult.value = transcript;
      copyBtn.classList.remove('hidden');
      showStatus('stt-status', 'Transcription complete!', 'success');
    } else {
      sttResult.value = '';
      showStatus('stt-status', 'No speech detected in the recording.', 'error');
    }

    convertBtn.disabled = false;
  } catch (err) {
    showStatus('stt-status', `STT error: ${err.message}`, 'error');
    convertBtn.disabled = false;
  }
}

/* ===== Helpers ===== */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // result is "data:<mime>;base64,<data>"
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read audio blob.'));
    reader.readAsDataURL(blob);
  });
}

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/* ===== Settings Panel ===== */
function setupSettingsPanel() {
  const apiKeyInput = document.getElementById('api-key-input');
  const toggleBtn = document.getElementById('toggle-key-visibility');
  const saveBtn = document.getElementById('save-settings-btn');

  // Toggle visibility
  toggleBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleBtn.title = 'Hide API key';
    } else {
      apiKeyInput.type = 'password';
      toggleBtn.title = 'Show API key';
    }
  });

  // Save
  saveBtn.addEventListener('click', async () => {
    const newKey = apiKeyInput.value.trim();
    if (!newKey) {
      showStatus('settings-status', 'Please enter a valid API key.', 'error');
      return;
    }

    apiKey = newKey;
    chrome.storage.local.set({ apiKey: newKey }, async () => {
      showStatus('settings-status', 'API key saved successfully!', 'success');
      // Reload voices with new key
      await loadVoices();
      setTimeout(() => hideStatus('settings-status'), 3000);
    });
  });
}

/* ===== Status Utilities ===== */
function showStatus(id, message, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.className = `status-msg ${type}`;
  // For loading, the spinner is CSS-only (::before pseudo)
}

function hideStatus(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = 'status-msg hidden';
  el.textContent = '';
}
