// Chat simulator (6.17). Sends text or a recorded voice note to POST /dev/simulate and renders the replies.
// Every value goes through textContent; Urdu text is shown with dir="auto".

const DEFAULT_PHONE = '923001234567';
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

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

export function init({ doc = globalThis.document, fetchImpl, mediaRecorderCtor = globalThis.MediaRecorder, getUserMedia } = {}) {
  const root = doc?.getElementById('simulator');
  if (!root) return null;

  const $ = (id) => doc.getElementById(id);
  const api = createSimulatorApi({ fetchImpl });
  const phoneInput = $('phone');
  const textInput = $('text');
  const sendButton = $('send');
  const recordButton = $('record');
  const log = $('log');
  const statusLine = $('status');

  phoneInput.value = DEFAULT_PHONE;

  function setStatus(text) {
    statusLine.textContent = text;
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

  async function startRecording() {
    if (recorder) return;
    const from = phone();
    if (!from) {
      setStatus('Enter a valid phone number before recording.');
      return;
    }
    if (!mediaRecorderCtor) {
      setStatus('This browser cannot record audio.');
      return;
    }
    try {
      stream = await (getUserMedia ?? globalThis.navigator.mediaDevices.getUserMedia.bind(globalThis.navigator.mediaDevices))({ audio: true });
      chunks = [];
      recorder = new mediaRecorderCtor(stream, { mimeType: 'audio/webm' });
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener('stop', () => finishRecording(from));
      recorder.start();
      recordButton.setAttribute('aria-pressed', 'true');
      setStatus('Recording... release to send.');
    } catch (err) {
      recorder = null;
      setStatus(`Microphone unavailable: ${err.message}`);
    }
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  async function finishRecording(from) {
    recordButton.setAttribute('aria-pressed', 'false');
    stream?.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: 'audio/webm' });
    chunks = [];
    recorder = null;
    stream = null;

    if (blob.size === 0) {
      setStatus('Nothing was recorded.');
      return;
    }
    if (blob.size > MAX_AUDIO_BYTES) {
      append(bubble(doc, 'system', 'The recording is larger than 5 MB. Please record a shorter clip.'));
      setStatus('');
      return;
    }
    const audioBase64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    const userNode = bubble(doc, 'me', '[voice note]', `from ${from}`);
    append(userNode);
    send({ from, audioBase64, mimeType: 'audio/webm' }, userNode);
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
