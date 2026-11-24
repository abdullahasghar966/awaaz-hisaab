import { mapWhisperLanguage } from '../lang/detect.js';

// Self-hosted speech-to-text via the whisper.cpp server (`whisper-server`), e.g. http://127.0.0.1:8080.
// Same result shape and language handling as openai.js. No audio leaves the machine.

const DEVANAGARI = /[ऀ-ॿ]/;
const DEFAULT_TIMEOUT_MS = 120000; // CPU transcription is slow

// Mirrors the extension map in openai.js (kept local so openai.js stays untouched).
const EXTENSIONS = {
  'audio/ogg': '.ogg',
  'audio/webm': '.webm',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/m4a': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
};

function extensionFor(mimeType) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[base] ?? '.ogg';
}

function isTimeout(err) {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

export function createWhisperLocalStt({
  url = 'http://127.0.0.1:8080',
  language = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
} = {}) {
  const base = String(url || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('STT_LOCAL_NO_URL');

  async function request({ buffer, mimeType, filename, lang }) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), filename);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    form.append('language', lang || 'auto');

    let res;
    try {
      res = await fetchImpl(`${base}/inference`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) throw new Error('STT_LOCAL_TIMEOUT');
      throw new Error('STT_LOCAL_UNREACHABLE');
    }
    if (!res.ok) throw new Error(`STT_LOCAL_HTTP_${res.status}`);
    return res.json();
  }

  return {
    name: 'whisper-local',
    async transcribe({ buffer, mimeType = 'audio/ogg', filename = 'audio.ogg' } = {}) {
      // The extension follows the mime type (codec suffix stripped). whisper-server needs ffmpeg for OGG/Opus.
      const name = filename.replace(/\.[^.]*$/, '') + extensionFor(mimeType);

      const first = await request({ buffer, mimeType, filename: name, lang: language });
      let text = String(first.text ?? '').trim();
      let lang = mapWhisperLanguage(first.language) ?? null;

      if (DEVANAGARI.test(text) && !language) {
        // Whisper often labels Urdu audio as Hindi (Devanagari output). Retry once, forcing Urdu.
        const retry = await request({ buffer, mimeType, filename: name, lang: 'ur' });
        text = String(retry.text ?? '').trim();
        lang = mapWhisperLanguage(retry.language) ?? 'ur';
      }

      return { text, language: lang, provider: 'whisper-local' };
    },
  };
}
