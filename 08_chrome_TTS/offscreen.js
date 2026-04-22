let mediaRecorder;
let audioChunks = [];
let recordedBlob;
let audioContext;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "play-audio") {
    playBase64Audio(message.audioContent);
  } else if (message.type === "start-recording") {
    startRecording(message.streamId).catch(console.error);
  } else if (message.type === "stop-recording") {
    stopRecording();
  } else if (message.type === "play-recorded") {
    playRecordedAudio();
  } else if (message.type === "get-recorded-audio") {
    getRecordedAudio(sendResponse);
    return true;
  }
});

function playBase64Audio(base64) {
  const audio = new Audio("data:audio/mp3;base64," + base64);
  audio.onended = () => {
    chrome.runtime.sendMessage({ type: "offscreen-task-completed", task: "play-audio" });
  };
  audio.play();
}

async function startRecording(streamId) {
  audioChunks = [];
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(audioContext.destination);

  const preferredMimeType = 'audio/webm;codecs=opus';
  const options = MediaRecorder.isTypeSupported(preferredMimeType)
    ? { mimeType: preferredMimeType }
    : {};

  mediaRecorder = new MediaRecorder(stream, options);
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) audioChunks.push(event.data);
  };
  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(audioChunks, { type: options.mimeType || '' });
    chrome.runtime.sendMessage({
      type: "recording-stopped",
      sampleRate: audioContext.sampleRate
    });
  };
  mediaRecorder.start();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
  }
  if (audioContext) {
    audioContext.close();
  }
}

function playRecordedAudio() {
  if (recordedBlob) {
    const url = URL.createObjectURL(recordedBlob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.play();
  }
}

async function getRecordedAudio(sendResponse) {
  if (!recordedBlob) {
    sendResponse({ error: "No recording found" });
    return;
  }

  const reader = new FileReader();
  reader.onloadend = () => {
    const base64 = reader.result.split(",")[1];
    sendResponse({ 
      audioContent: base64, 
      sampleRate: audioContext ? audioContext.sampleRate : 48000 
    });
    // 内容传输完成后，可以通知 background 准备关闭
    chrome.runtime.sendMessage({ type: "offscreen-task-completed", task: "stt-data-sent" });
  };
  reader.readAsDataURL(recordedBlob);
}
