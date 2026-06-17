'use strict';

let state = 'waiting';
let history = [];
let myvad = null;

const orb      = document.getElementById('orb');
const statusEl = document.getElementById('status');
const userBub  = document.getElementById('user-bubble');
const buddyBub = document.getElementById('buddy-bubble');
const overlay  = document.getElementById('overlay');

function setState(s) {
  state = s;
  document.body.dataset.state = s;
  statusEl.textContent = ({ listening: 'Listening', processing: 'Thinking', speaking: 'Speaking' })[s] || '';
}

function showBubble(el, text) {
  el.classList.remove('visible');
  el.textContent = text;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
}

// ── Entry point: iOS needs one explicit gesture to unlock audio ──
overlay.addEventListener('click', async () => {
  overlay.classList.add('fade-out');
  setTimeout(() => overlay.remove(), 650);
  // iOS: must call speak() inside a user gesture to unlock the audio pipeline.
  // Don't cancel — let the near-silent utterance actually queue so iOS registers it.
  const unlock = new SpeechSynthesisUtterance(' ');
  unlock.volume = 0.01;
  speechSynthesis.speak(unlock);
  await startVAD();
}, { once: true });

async function startVAD() {
  setState('listening');

  // Point ONNX runtime at its own CDN WASM files
  if (window.ort) {
    window.ort.env.wasm.wasmPaths =
      'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.14.0/dist/';
  }

  try {
    myvad = await window.vad.MicVAD.new({
      workletURL: '/vad/vad.worklet.bundle.min.js',
      modelURL:   '/vad/silero_vad.onnx',
      positiveSpeechThreshold: 0.6,
      negativeSpeechThreshold: 0.35,
      minSpeechFrames: 5,
      preSpeechPadFrames: 3,
      redemptionFrames: 10,

      onSpeechStart() {
        if (state === 'listening') orb.classList.add('user-speaking');
      },

      async onSpeechEnd(audio) {
        orb.classList.remove('user-speaking');
        if (state !== 'listening') return;
        await handleAudio(audio);
      },

      onVADMisfire() {
        orb.classList.remove('user-speaking');
      },
    });

    myvad.start();
  } catch (err) {
    console.error('VAD init failed:', err);
    statusEl.textContent = 'Mic access needed';
    document.body.dataset.state = 'waiting';
  }
}

async function handleAudio(audio) {
  setState('processing');
  myvad.pause();

  const wav  = encodeWAV(audio);
  const form = new FormData();
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
  form.append('history', JSON.stringify(history));

  try {
    const res = await fetch('/respond', { method: 'POST', body: form });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { transcript, response } = await res.json();

    if (transcript) {
      showBubble(userBub, transcript);
      history.push({ role: 'user',      content: transcript });
      history.push({ role: 'assistant', content: response  });
      if (history.length > 20) history = history.slice(-20);

      await speak(response);
      showBubble(buddyBub, response);
    }
  } catch (err) {
    console.error('handleAudio error:', err);
  }

  setState('listening');
  myvad.start();
}

// ── WAV encoder (Float32 PCM → 16-bit mono WAV) ──
function encodeWAV(samples, sr = 16000) {
  const buf  = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buf);
  const str  = (off, s) => [...s].forEach((c, i) => view.setUint8(off + i, c.charCodeAt(0)));

  str(0,  'RIFF'); view.setUint32(4,  36 + samples.length * 2, true);
  str(8,  'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true);            // chunk size
  view.setUint16(20, 1,  true);            // PCM
  view.setUint16(22, 1,  true);            // mono
  view.setUint32(24, sr,      true);       // sample rate
  view.setUint32(28, sr * 2,  true);       // byte rate
  view.setUint16(32, 2,       true);       // block align
  view.setUint16(34, 16,      true);       // bits/sample
  str(36, 'data'); view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buf;
}

// ── TTS ──
function getVoice(text) {
  const voices = speechSynthesis.getVoices();
  const isChinese = /[一-鿿]/.test(text);
  if (isChinese) {
    return (
      voices.find(v => v.lang.startsWith('zh') && v.localService) ||
      voices.find(v => v.lang.startsWith('zh')) ||
      voices[0]
    );
  }
  return (
    voices.find(v => v.lang === 'en-US' && v.localService) ||
    voices.find(v => v.lang.startsWith('en') && v.localService) ||
    voices.find(v => v.lang.startsWith('en')) ||
    voices[0]
  );
}

function speak(text) {
  return new Promise(resolve => {
    setState('speaking');
    speechSynthesis.cancel(); // clear any stuck iOS queue
    const go = () => {
      const utter = new SpeechSynthesisUtterance(text);
      const voice = getVoice(text);
      if (voice) utter.voice = voice;
      utter.rate  = 1.05;
      utter.pitch = 1.0;
      // iOS onend often never fires — timeout ensures we always continue
      const timer = setTimeout(resolve, Math.max(4000, text.length * 120));
      utter.onend   = () => { clearTimeout(timer); resolve(); };
      utter.onerror = () => { clearTimeout(timer); resolve(); };
      window.speechSynthesis.speak(utter);
    };
    if (speechSynthesis.getVoices().length > 0) {
      go();
    } else {
      // iOS: voiceschanged may never fire — fall back after 300ms
      const t = setTimeout(go, 300);
      speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); go(); }, { once: true });
    }
  });
}

// ── Service worker ──
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js'));
}
