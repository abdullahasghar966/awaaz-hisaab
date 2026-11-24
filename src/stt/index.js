import { createOpenAiStt } from './openai.js';
import { createMockStt } from './mock.js';
import { createWhisperLocalStt } from './whisper-local.js';

// Selects the STT provider from config.stt ({ provider, apiKey, model, language, baseUrl, localUrl }).
export function createStt(sttConfig, { fetchImpl = fetch, logger } = {}) {
  const provider = sttConfig?.provider ?? 'mock';

  if (provider === 'openai') {
    const stt = createOpenAiStt({
      apiKey: sttConfig.apiKey,
      model: sttConfig.model,
      language: sttConfig.language,
      baseUrl: sttConfig.baseUrl,
      fetchImpl,
    });
    logger?.info('stt provider: openai', { model: sttConfig.model });
    return stt;
  }

  if (provider === 'whisper-local') {
    const stt = createWhisperLocalStt({
      url: sttConfig.localUrl,
      language: sttConfig.language,
      fetchImpl,
    });
    logger?.info('stt provider: whisper-local', { url: sttConfig.localUrl });
    return stt;
  }

  if (provider === 'mock') {
    logger?.info('stt provider: mock');
    return createMockStt();
  }

  throw new Error(`Unknown STT provider: ${provider}`);
}
