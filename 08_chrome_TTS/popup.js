const elements = {
  tabs: {
    tts: document.getElementById('tab-tts'),
    stt: document.getElementById('tab-stt'),
    settings: document.getElementById('tab-settings')
  },
  sections: {
    tts: document.getElementById('section-tts'),
    stt: document.getElementById('section-stt'),
    settings: document.getElementById('section-settings')
  },
  apiKey: document.getElementById('api-key'),
  saveSettings: document.getElementById('btn-save-settings'),
  ttsInput: document.getElementById('tts-input'),
  ttsLangSelect: document.getElementById('tts-lang-select'),
  modelSelect: document.getElementById('model-select'),
  voiceSelect: document.getElementById('voice-select'),
  btnTtsPlay: document.getElementById('btn-tts-play'),
  btnRecord: document.getElementById('btn-record'),
  recordingStatus: document.getElementById('recording-status'),
  audioPlayback: document.getElementById('audio-playback'),
  btnSttConvert: document.getElementById('btn-stt-convert'),
  sttResult: document.getElementById('stt-result'),
  sttLangSelect: document.getElementById('stt-lang-select'),
  btnClearTts: document.getElementById('btn-clear-tts'),
  btnTtsStop: document.getElementById('btn-tts-stop'),
  btnTtsDownload: document.getElementById('btn-tts-download'),
  btnCopyStt: document.getElementById('btn-copy-stt'),
  btnReuseStt: document.getElementById('btn-reuse-stt'),
  statusMessage: document.getElementById('status-message'),
  effectsSelect: document.getElementById('effects-select'),
  inputRate: document.getElementById('input-rate'),
  inputPitch: document.getElementById('input-pitch'),
  valRate: document.getElementById('val-rate'),
  valPitch: document.getElementById('val-pitch')
};

let apiKey = '';
let allVoices = [];
let isRecording = false;
let isConverting = false;
let isStopping = false;
let audioDataUrl = null;
let offscreenReadyPromise = null;
let resolveOffscreenReady = null;
let offscreenCreating = null;

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'offscreen-ready' && message.target === 'popup') {
    if (resolveOffscreenReady) resolveOffscreenReady();
  } else if (message.type === 'audio-finished') {
    elements.btnTtsStop.disabled = true;
    showMessage('Playback finished');
  }
});

async function setupOffscreen(reasons, justification) {
  if (await chrome.offscreen.hasDocument()) return;
  if (offscreenCreating) return offscreenCreating;

  offscreenCreating = new Promise(async (resolve, reject) => {
    try {
      offscreenReadyPromise = new Promise((res, rej) => {
        resolveOffscreenReady = res;
        setTimeout(() => {
          if (resolveOffscreenReady) {
            resolveOffscreenReady = null;
            rej(new Error('Offscreen Document Timeout'));
          }
        }, 5000);
      });
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA'], // Request all up front
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

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const data = await chrome.storage.local.get([
      'apiKey', 'rate', 'pitch', 'effects', 'sttLang', 'ttsLang', 'ttsModel'
    ]);
    
    if (data.apiKey) {
      apiKey = data.apiKey;
      elements.apiKey.value = apiKey;
      loadVoices();
    } else {
      showSection('settings');
      showMessage('Please set your API Key.');
    }

  // Restore preferences
  if (data.rate) {
    elements.inputRate.value = data.rate;
    elements.valRate.textContent = data.rate;
  }
  if (data.pitch) {
    elements.inputPitch.value = data.pitch;
    elements.valPitch.textContent = data.pitch;
  }
  if (data.effects) elements.effectsSelect.value = data.effects;
  if (data.sttLang) elements.sttLangSelect.value = data.sttLang;
  if (data.ttsLang) elements.ttsLangSelect.value = data.ttsLang;
  if (data.ttsModel) elements.modelSelect.value = data.ttsModel;

  // Persistence listeners
  elements.inputRate.onchange = (e) => chrome.storage.local.set({ rate: e.target.value });
  elements.inputPitch.onchange = (e) => chrome.storage.local.set({ pitch: e.target.value });
  elements.effectsSelect.onchange = (e) => chrome.storage.local.set({ effects: e.target.value });
  elements.sttLangSelect.onchange = (e) => chrome.storage.local.set({ sttLang: e.target.value });
  elements.ttsLangSelect.onchange = (e) => {
    chrome.storage.local.set({ ttsLang: e.target.value });
    renderVoices();
  };
  elements.modelSelect.onchange = (e) => {
    chrome.storage.local.set({ ttsModel: e.target.value });
    renderVoices();
  };
  elements.voiceSelect.onchange = (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt) {
      chrome.storage.local.set({ 
        preferredVoice: e.target.value,
        preferredLang: opt.dataset.lang 
      });
    }
  };

  // UI listeners
  elements.inputRate.oninput = () => elements.valRate.textContent = elements.inputRate.value;
  elements.inputPitch.oninput = () => elements.valPitch.textContent = elements.inputPitch.value;
  
  Object.keys(elements.tabs).forEach(tab => {
    elements.tabs[tab].addEventListener('click', () => showSection(tab));
  });

  elements.saveSettings.addEventListener('click', saveSettings);
  elements.btnTtsPlay.addEventListener('click', playTTS);
  elements.btnTtsStop.addEventListener('click', stopTTS);
  elements.btnTtsDownload.addEventListener('click', downloadTTS);
  elements.btnClearTts.addEventListener('click', () => elements.ttsInput.value = '');
  elements.btnRecord.addEventListener('mousedown', startRecording);
  elements.btnRecord.addEventListener('mouseup', stopRecording);
  elements.btnRecord.addEventListener('mouseleave', stopRecording);
  elements.btnSttConvert.addEventListener('click', convertSTT);
  elements.btnCopyStt.addEventListener('click', copySTT);
  elements.btnReuseStt.addEventListener('click', reuseSTT);

  // Sync state with offscreen if it exists
  if (await chrome.offscreen.hasDocument()) {
    const status = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'get-status' });
    if (status?.isRecording) {
      isRecording = true;
      elements.btnRecord.classList.add('recording');
      elements.recordingStatus.textContent = 'Recording (Recovered)...';
      elements.btnSttConvert.disabled = true;
    }
  }
  } catch (err) {

    console.error('Initialization error:', err);
    showMessage('Error initializing extension.');
  }
});

function showSection(name) {
  Object.keys(elements.sections).forEach(s => {
    elements.sections[s].classList.toggle('hidden', s !== name);
    elements.tabs[s].classList.toggle('active', s === name);
  });
}

let messageTimer = null;
function showMessage(msg, duration = 3000) {
  if (messageTimer) clearTimeout(messageTimer);
  elements.statusMessage.textContent = msg;
  if (duration > 0) {
    messageTimer = setTimeout(() => {
      elements.statusMessage.textContent = '';
      messageTimer = null;
    }, duration);
  }
}

async function saveSettings() {
  const key = elements.apiKey.value.trim();
  if (key) {
    await chrome.storage.local.set({ apiKey: key });
    apiKey = key;
    showMessage('API Key saved!');
    loadVoices();
  }
}

async function loadVoices() {
  if (!apiKey) return;
  elements.voiceSelect.disabled = true;
  try {
    const response = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${apiKey}`);
    if (!response.ok) throw new Error('Failed to load voices');
    const data = await response.json();
    if (data.voices) {
      allVoices = data.voices;
      
      // Update language select with available languages (optional, but good for completeness)
      // For now, keep the defaults but ensure they exist in the list
      const langs = [...new Set(allVoices.flatMap(v => v.languageCodes))].sort();
      const currentLang = elements.ttsLangSelect.value;
      
      // If we want to dynamically fill languages:
      /*
      elements.ttsLangSelect.innerHTML = langs.map(l => 
        `<option value="${l}" ${l === currentLang ? 'selected' : ''}>${l}</option>`
      ).join('');
      */
      
      renderVoices();
    }
  } catch (error) {
    console.error('Failed to load voices:', error);
    elements.voiceSelect.innerHTML = '<option value="">Error loading voices</option>';
    showMessage('Error: Failed to fetch voices. Check your API Key and connection.');
  } finally {
    elements.voiceSelect.disabled = false;
  }
}

function renderVoices() {
  const selectedLang = elements.ttsLangSelect.value;
  const selectedModel = elements.modelSelect.value; // Wavenet, Neural2, Studio, Polyglot, or empty for Standard
  
  const filtered = allVoices.filter(v => {
    // Check for language match
    // Standardize: if user selects zh-CN, also match cmn-CN
    let matchesLang = v.languageCodes.some(lc => lc.startsWith(selectedLang.split('-')[0]));
    if (selectedLang.startsWith('zh')) {
      matchesLang = matchesLang || v.languageCodes.some(lc => lc.startsWith('cmn'));
    }
    
    let matchesModel = false;
    if (selectedModel === '') {
      // Standard voices usually don't have these keywords in their name
      matchesModel = !['Wavenet', 'Neural2', 'Studio', 'Polyglot'].some(m => v.name.includes(m));
    } else {
      matchesModel = v.name.includes(selectedModel);
    }
    
    return matchesLang && matchesModel;
  });

  chrome.storage.local.get(['preferredVoice'], (data) => {
    const preferredVoice = data.preferredVoice;
    elements.voiceSelect.innerHTML = filtered
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(v => {
        const selected = v.name === preferredVoice ? 'selected' : '';
        const type = v.name.includes('Wavenet') ? 'Wavenet' : 
                     v.name.includes('Neural2') ? 'Neural2' :
                     v.name.includes('Studio') ? 'Studio' :
                     v.name.includes('Polyglot') ? 'Polyglot' : 'Standard';
        
        // Display info including Natural Sample Rate as referenced in issue
        const displayName = `${v.name} (${v.ssmlGender}, ${v.naturalSampleRateHertz}Hz)`;
        return `<option value="${v.name}" data-lang="${v.languageCodes[0]}" ${selected}>${displayName}</option>`;
      })
      .join('');
      
    if (filtered.length === 0) {
      elements.voiceSelect.innerHTML = '<option value="">No voices found for this model/lang</option>';
    }
  });
}

async function playTTS() {
  const text = elements.ttsInput.value.trim();
  const voiceOption = elements.voiceSelect.selectedOptions[0];
  const voiceName = elements.voiceSelect.value;
  
  if (!text || !voiceName || !voiceOption || !apiKey) {
      showMessage('Incomplete parameters.');
      return;
  }

  if (text.length > 5000) {
    showMessage('Text too long (max 5000 chars).');
    return;
  }

  elements.btnTtsPlay.disabled = true;
  showMessage('Synthesizing (Google Cloud TTS)...', 0);

  try {
    const rate = Math.max(0.25, Math.min(4.0, parseFloat(elements.inputRate.value) || 1.0));
    const pitch = Math.max(-20.0, Math.min(20.0, parseFloat(elements.inputPitch.value) || 0.0));
    const effects = elements.effectsSelect.value ? [elements.effectsSelect.value] : [];

    const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`, {
      method: 'POST',
      body: JSON.stringify({
        input: { text },
        voice: { name: voiceName, languageCode: voiceOption.dataset.lang },
        audioConfig: { 
          audioEncoding: 'MP3',
          speakingRate: rate,
          pitch: pitch,
          effectsProfileId: effects
        }
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `TTS Failed (${response.status})`);
    }

    const data = await response.json();
    if (data.audioContent) {
      audioDataUrl = `data:audio/mp3;base64,${data.audioContent}`;
      await setupOffscreen(['AUDIO_PLAYBACK', 'USER_MEDIA'], 'TTS Playback');
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'play-audio', dataUrl: audioDataUrl, source: 'popup' });
      elements.btnTtsStop.disabled = false;
      elements.btnTtsDownload.disabled = false;
      showMessage('Playing...');
    } else {
      throw new Error('No audio content returned');
    }
  } catch (error) {
    showMessage('Error: ' + error.message);
  } finally {
    elements.btnTtsPlay.disabled = false;
  }
}

async function stopTTS() {
  try {
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop-audio' });
    elements.btnTtsStop.disabled = true;
    showMessage('Stopped');
  } catch (e) {}
}

function downloadTTS() {
  if (audioDataUrl && audioDataUrl.startsWith('data:audio/')) {
    const link = document.createElement('a');
    link.href = audioDataUrl;
    link.download = `tts_${Date.now()}.mp3`;
    link.click();
  } else {
    showMessage('No audio available for download.');
  }
}

let isStartingRecording = false;

async function startRecording() {
  if (isRecording || isStartingRecording || isConverting || !apiKey) return;
  isStartingRecording = true;
  
  try {
    // 1. Get streamId FIRST to capture user gesture context
    const streamId = await new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: null }, (id) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(id);
      });
    });

    // 2. Then ensure offscreen is ready
    await setupOffscreen(['AUDIO_PLAYBACK', 'USER_MEDIA'], 'Capturing audio');

    // 3. Start recording
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start-recording', streamId });
    if (res?.success) {
      isRecording = true;
      elements.btnRecord.classList.add('recording');
      elements.recordingStatus.textContent = 'Recording...';
      elements.btnSttConvert.disabled = true;
      showMessage('Recording...');
    } else {
      throw new Error(res?.error || 'Failed to start recording');
    }
  } catch (error) { 
    showMessage('Error: ' + error.message); 
  } finally {
    isStartingRecording = false;
  }
}

async function stopRecording() {
  // If it's still starting, we wait a bit or handle it
  if (isStartingRecording) {
    let checks = 0;
    while (isStartingRecording && checks < 10) {
      await new Promise(r => setTimeout(r, 100));
      checks++;
    }
  }
  
  if (!isRecording || isStopping) return;
  isStopping = true;
  isRecording = false;
  elements.btnRecord.classList.remove('recording');
  elements.recordingStatus.textContent = 'Processing...';

  try {
    const res = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop-recording' });
    if (res?.success) {
      elements.audioPlayback.src = res.dataUrl;
      elements.recordingStatus.textContent = 'Ready';
      elements.btnSttConvert.disabled = false;
      showMessage('Stopped');
    } else {
      throw new Error(res?.error || 'Failed to stop recording');
    }
  } catch (error) { 
    showMessage('Error: ' + error.message); 
    elements.recordingStatus.textContent = 'Ready';
  } finally { 
    isStopping = false; 
  }
}

async function convertSTT() {
  if (isConverting || isRecording) return;

  const url = elements.audioPlayback.src;
  if (!url || !apiKey || !url.startsWith('data:audio/')) {
      showMessage('No valid recording.');
      return;
  }

  isConverting = true;
  elements.btnSttConvert.disabled = true;
  elements.btnRecord.disabled = true;
  
  showMessage('Preparing audio data...', 0);
  
  try {
    const audioContent = url.split(',')[1];
    
    showMessage('Connecting to Google Cloud Speech-to-Text...', 0);
    
    const response = await fetch(`https://speech.googleapis.com/v1/speech:recognize?key=${apiKey}`, {
      method: 'POST',
      body: JSON.stringify({
        config: {
          encoding: 'WEBM_OPUS',
          enableAutomaticPunctuation: true,
          languageCode: elements.sttLangSelect.value,
        },
        audio: { content: audioContent }
      })
    });

    showMessage('Processing transcription...', 0);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `STT Failed (${response.status})`);
    }

    const data = await response.json();
    if (data.results?.length > 0) {
      elements.sttResult.value = data.results.map(r => r.alternatives[0].transcript).join('\n');
      showMessage('Conversion complete!', 3000);
    } else {
      showMessage('No speech recognized.', 3000);
    }
  } catch (error) { 
    showMessage('Error: ' + error.message, 5000); 
  } finally { 
    isConverting = false;
    elements.btnSttConvert.disabled = false;
    elements.btnRecord.disabled = false;
  }
}

async function copySTT() {
  if (elements.sttResult.value) {
    try {
      await navigator.clipboard.writeText(elements.sttResult.value);
      showMessage('Copied!');
    } catch (err) {
      showMessage('Failed to copy.');
    }
  }
}

function reuseSTT() {
  if (elements.sttResult.value) {
    elements.ttsInput.value = elements.sttResult.value;
    showSection('tts');
  }
}
