import { mapWhisperLanguage } from '../lang/detect.js';

const DEVANAGARI = /[ऀ-ॿ]/;
const PROMPT = 'حساب کتاب: ہزار، لاکھ، روپے، ادھار، بوری، سیمنٹ۔ hazar, lakh, udhaar, sale, kharcha';

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

// 'audio/ogg; codecs=opus' -> '.ogg'. Unknown types default to '.ogg'.
function extensionFor(mimeType) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return EXTENSIONS[base] ?? '.ogg';
}

export function createOpenAiStt({
  apiKey,
  model = 'whisper-1',
  language = '',
  baseUrl = 'https://api.openai.com/v1',
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new Error('STT_NO_API_KEY');

  async function request({ buffer, mimeType, filename, lang }) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), filename);
    form.append('model', model);
    form.append('response_format', model === 'whisper-1' ? 'verbose_json' : 'json');
    form.append('prompt', PROMPT);
    if (lang) form.append('language', lang);

    const res = await fetchImpl(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`STT_HTTP_${res.status}`);
    return res.json();
  }

  return {
    name: 'openai',
    async transcribe({ buffer, mimeType = 'audio/ogg', filename = 'audio.ogg' } = {}) {
      // NOTE: the extension follows the mime type (codec suffix stripped), so the upload name matches the format.
      const name = filename.replace(/\.[^.]*$/, '') + extensionFor(mimeType);

      const first = await request({ buffer, mimeType, filename: name, lang: language });
      let text = String(first.text ?? '').trim();
      let lang = mapWhisperLanguage(first.language) ?? null;

      if (DEVANAGARI.test(text) && !language) {
        // Whisper sometimes labels Urdu audio as Hindi (Devanagari output). Retry once, forcing Urdu.
        const retry = await request({ buffer, mimeType, filename: name, lang: 'ur' });
        text = String(retry.text ?? '').trim();
        // NOTE: the forced language is known, so the retry result is reported as 'ur' when Whisper names none.
        lang = mapWhisperLanguage(retry.language) ?? 'ur';
      }

      return { text, language: lang, provider: 'openai' };
    },
  };
}
