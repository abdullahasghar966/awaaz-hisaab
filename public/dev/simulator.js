// Chat simulator (6.17). Sends text or a recorded voice note to POST /dev/simulate and renders the replies.
// Voice notes are also transcribed in the browser (Web Speech API); the text goes along as `transcript`.
// Every value goes through textContent; Urdu text is shown with dir="auto".

const DEFAULT_PHONE = '923001234567';
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const DEFAULT_LANG = 'ur-PK';
const LANG_STORAGE_KEY = 'awaaz-hisaab.sttLang';
// How long to wait for the recognizer's final result after the button is released.
export const STT_WAIT_MS = 1500;

export const STT_LANGUAGES = [
  { code: 'ur-PK', label: 'Urdu' },
  { code: 'en-US', label: 'English' },
  { code: 'pa-Guru-IN', label: 'Punjabi' },
  { code: 'ps-AF', label: 'Pashto' },
  { code: 'sd-IN', label: 'Sindhi' },
];

export const MESSAGES = {
  noSpeech: "This browser can't transcribe speech — use Chrome or Edge, or type the message.",
  noWords: "Couldn't hear any words — try again or type the message",
  notAllowed: 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.',
};

// fetchImpl is injected so the API client can be tested without a server.
export function createSimulatorApi({ baseUrl = '', fetchImpl = fetch } = {}) {
  return {
    async simulate(payload) {
      const res = await fetchImpl(`${baseUrl}/dev/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ? `Request failed: ${json.error}` : `Request failed (HTTP ${res.status}).`);
      return json;
    },
  };
}

// Base64 for a Uint8Array, built in chunks so large clips do not overflow the call stack.
export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

// Builds one chat bubble. Kind is 'me', 'bot' or 'system'.
export function bubble(doc, kind, text, meta = '') {
  const node = doc.createElement('div');
  node.className = `bubble ${kind}`;
  const body = doc.createElement('div');
  body.className = 'bubble-text';
  body.setAttribute('dir', 'auto');
  body.textContent = text;
  node.append(body);
  if (meta) {
    const info = doc.createElement('div');
    info.className = 'bubble-meta';
    info.textContent = meta;
    node.append(info);
  }
  return node;
}

// The browser's speech recognizer constructor, or null when the browser has none (Firefox, some mobile browsers).
export function speechRecognitionCtor(scope = globalThis) {
  return scope.SpeechRecognition || scope.webkitSpeechRecognition || null;
}

function storageOrNull() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked by the browser (e.g. some sandboxed frames)
  }
}

export function readSavedLanguage(storage = storageOrNull()) {
  try {
    const saved = storage?.getItem(LANG_STORAGE_KEY);
    if (STT_LANGUAGES.some((lang) => lang.code === saved)) return saved;
  } catch {
    // unreadable storage: fall back to the default
  }
  return DEFAULT_LANG;
}

export function saveLanguage(code, storage = storageOrNull()) {
  try {
    storage?.setItem(LANG_STORAGE_KEY, code);
  } catch {
    // not remembered; the selection still works for this page view
  }
}

// Wraps one Web Speech recognition run. Interim text is reported through onInterim; finish() stops listening
// and resolves with { text, blocked } after the final result, or after STT_WAIT_MS at most.
export function createSpeechSession(Ctor, { lang = DEFAULT_LANG, onInterim, onError } = {}) {
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;

  const finals = [];
  let interim = '';
  let stopping = false;
  let blocked = false;
  let resolveEnded;
  const ended = new Promise((resolve) => {
    resolveEnded = resolve;
  });

  const current = () => [...finals, interim.trim()].filter(Boolean).join(' ');

  rec.onresult = (event) => {
    interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) {
        if (text.trim()) finals.push(text.trim());
      } else {
        interim += text;
      }
    }
    onInterim?.(current());
  };

  rec.onerror = (event) => {
    const code = event?.error ?? 'unknown';
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      blocked = true;
      stopping = true;
    }
    if (code !== 'no-speech' && code !== 'aborted') onError?.(code);
  };

  rec.onend = () => {
    // Browsers end continuous sessions on their own after silence; restart while the button is still held.
    if (!stopping) {
      try {
        rec.start();
        return;
      } catch {
        // could not restart: treat the session as ended
      }
    }
    resolveEnded();
  };

  rec.start(); // throws if the browser refuses to start; the caller handles it

  return {
    get blocked() {
      return blocked;
    },
    finish() {
      stopping = true;
      try {
        rec.stop();
      } catch {
        // already stopped
      }
      let timer = null;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(resolve, STT_WAIT_MS);
      });
      return Promise.race([ended, timeout]).then(() => {
        clearTimeout(timer);
        return { text: current(), blocked };
      });
    },
  };
}

// fetchImpl, mediaRecorderCtor, getUserMedia and speechCtor are injectable for tests. speechCtor: null disables speech.
export function init({
  doc = globalThis.document,
  fetchImpl,
  mediaRecorderCtor = globalThis.MediaRecorder,
  getUserMedia,
  speechCtor = speechRecognitionCtor(),
  storage = storageOrNull(),
} = {}) {
  const root = doc?.getElementById('simulator');
  if (!root) return null;

  const $ = (id) => doc.getElementById(id);
  const api = createSimulatorApi({ fetchImpl });
  const phoneInput = $('phone');
  const textInput = $('text');
  const sendButton = $('send');
  const recordButton = $('record');
  const langSelect = $('lang');
  const interimLine = $('interim');
  const log = $('log');
  const statusLine = $('status');

  phoneInput.value = DEFAULT_PHONE;

  for (const lang of STT_LANGUAGES) {
    const option = doc.createElement('option');
    option.value = lang.code;
    option.textContent = lang.label;
    langSelect.append(option);
  }
  langSelect.value = readSavedLanguage(storage);
  langSelect.addEventListener('change', () => saveLanguage(langSelect.value, storage));

  function setStatus(text) {
    statusLine.textContent = text;
  }

  function setInterim(text) {
    interimLine.textContent = text;
  }

  function append(node) {
    log.append(node);
    node.scrollIntoView?.({ block: 'end' });
  }

  function phone() {
    const digits = digitsOnly(phoneInput.value);
    return digits.length >= 10 ? digits : null;
  }

  function renderReplies(result) {
    const meta = [
      result.intent ? `intent: ${result.intent}` : null,
      result.language ? `lang: ${result.language}` : null,
      result.status ? `status: ${result.status}` : null,
    ].filter(Boolean).join(' | ');
    for (const reply of result.replies ?? []) {
      append(bubble(doc, 'bot', reply.text, reply.key ? `${reply.key}${meta ? ` | ${meta}` : ''}` : meta));
    }
    if (!result.replies || result.replies.length === 0) {
      append(bubble(doc, 'system', 'No reply was produced for this message.', meta));
    }
  }

  async function send(payload, userNode) {
    setStatus('Sending...');
    sendButton.disabled = true;
    recordButton.disabled = true;
    try {
      const result = await api.simulate(payload);
      const transcriptNote = result.transcript ? `transcript: ${result.transcript}` : '';
      if (userNode && transcriptNote) {
        const info = doc.createElement('div');
        info.className = 'bubble-meta';
        info.textContent = transcriptNote;
        userNode.append(info);
      }
      renderReplies(result);
      setStatus('');
    } catch (err) {
      append(bubble(doc, 'system', err.message));
      setStatus('');
    } finally {
      sendButton.disabled = false;
      recordButton.disabled = false;
    }
  }

  // Text messages
  $('composer').addEventListener('submit', (event) => {
    event.preventDefault();
    const from = phone();
    const text = textInput.value.trim();
    if (!from) {
      setStatus('Enter a valid phone number (at least 10 digits).');
      return;
    }
    if (!text) return;
    const userNode = bubble(doc, 'me', text, `from ${from}`);
    append(userNode);
    textInput.value = '';
    send({ from, text }, userNode);
  });

  // Voice notes: hold the button to record, release to send.
  let recorder = null;
  let chunks = [];
  let stream = null;
  let speech = null; // recognizer session for the recording in progress
  let pendingSpeech = null; // finish() promise handed from stopRecording to finishRecording
  let holding = false; // true from press until release; checked again after the async mic prompt

  function releaseStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  function onSpeechError(code) {
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      setStatus(MESSAGES.notAllowed);
    } else {
      setStatus(`Speech recognition error: ${code}. Try again or type the message.`);
    }
  }

  async function startRecording() {
    if (holding || recorder) return;
    holding = true;
    const from = phone();
    if (!from) {
      holding = false;
      setStatus('Enter a valid phone number before recording.');
      return;
    }
    if (!mediaRecorderCtor) {
      holding = false;
      setStatus('This browser cannot record audio.');
      return;
    }
    try {
      stream = await (getUserMedia ?? globalThis.navigator.mediaDevices.getUserMedia.bind(globalThis.navigator.mediaDevices))({ audio: true });
    } catch (err) {
      holding = false;
      setStatus(`Microphone unavailable: ${err.message}`);
      return;
    }
    if (!holding) {
      // released while the microphone prompt was open
      releaseStream();
      return;
    }

    chunks = [];
    setInterim('');
    try {
      recorder = new mediaRecorderCtor(stream, { mimeType: 'audio/webm' });
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => finishRecording(from));
      recorder.start();
    } catch (err) {
      holding = false;
      recorder = null;
      releaseStream();
      setStatus(`Microphone unavailable: ${err.message}`);
      return;
    }

    let hint = '';
    speech = null;
    if (speechCtor) {
      try {
        speech = createSpeechSession(speechCtor, {
          lang: langSelect.value,
          onInterim: (text) => setInterim(text),
          onError: onSpeechError,
        });
      } catch (err) {
        hint = `Speech recognition could not start (${err.message}).`;
      }
    } else {
      hint = MESSAGES.noSpeech;
    }
    recordButton.setAttribute('aria-pressed', 'true');
    langSelect.disabled = true;
    setStatus(['Recording... release to send.', hint].filter(Boolean).join(' '));
  }

  function stopRecording() {
    if (!holding) return;
    holding = false;
    if (speech) {
      pendingSpeech = speech.finish();
      speech = null;
    }
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  async function finishRecording(from) {
    recordButton.setAttribute('aria-pressed', 'false');
    langSelect.disabled = false;
    releaseStream();
    const heard = pendingSpeech ? await pendingSpeech : null;
    pendingSpeech = null;
    const blob = new Blob(chunks, { type: 'audio/webm' });
    chunks = [];
    recorder = null;
    setInterim('');

    if (heard?.blocked) {
      setStatus(MESSAGES.notAllowed);
      return;
    }
    if (blob.size === 0) {
      setStatus('Nothing was recorded.');
      return;
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      append(bubble(doc, 'system', 'The recording is larger than 5 MB. Please record a shorter clip.'));
      setStatus('');
      return;
    }
    if (heard && !heard.text) {
      setStatus(MESSAGES.noWords);
      return;
    }
    const audioBase64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const userNode = bubble(doc, 'me', '[voice note]', `from ${from}`);
    append(userNode);
    const payload = { from, audioBase64, mimeType: 'audio/webm' };
    if (heard?.text) payload.transcript = heard.text;
    send(payload, userNode);
  }

  recordButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    startRecording();
  });
  recordButton.addEventListener('pointerup', stopRecording);
  recordButton.addEventListener('pointerleave', stopRecording);
  recordButton.addEventListener('pointercancel', stopRecording);
  // Keyboard: Space or Enter starts recording on keydown and sends on keyup.
  recordButton.addEventListener('keydown', (event) => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault();
      startRecording();
    }
  });
  recordButton.addEventListener('keyup', (event) => {
    if (event.key === ' ' || event.key === 'Enter') stopRecording();
  });

  return { api };
}

if (typeof document !== 'undefined' && document.getElementById('simulator')) {
  init({ fetchImpl: (...args) => globalThis.fetch(...args) });
}
