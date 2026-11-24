// NLP facade (spec 6.10): quick-match -> LLM (Claude or Ollama) -> rules fallback.
import { quickMatch, parseWithRules } from './rules.js';
import { createLlmParser } from './llm.js';
import { createOllamaParser } from './ollama.js';

export function createNlp(nlpConfig = {}, { client = null, logger, fetchImpl } = {}) {
  const {
    provider = 'auto', apiKey = '', model, timeoutMs,
    ollamaUrl, ollamaModel, ollamaTimeoutMs, ollamaNumCtx, ollamaKeepAlive,
  } = nlpConfig;
  const useOllama = provider === 'ollama';
  const useLlm = !useOllama && (provider === 'llm' || (provider === 'auto' && Boolean(apiKey || client)));
  let llm = null;
  if (useOllama) {
    llm = createOllamaParser({
      url: ollamaUrl || undefined,
      model: ollamaModel || undefined,
      timeoutMs: ollamaTimeoutMs || undefined,
      numCtx: ollamaNumCtx || undefined,
      keepAlive: ollamaKeepAlive || undefined,
      fetchImpl: fetchImpl || undefined,
    });
  } else if (useLlm) {
    llm = createLlmParser({ apiKey, model: model || undefined, timeoutMs: timeoutMs || undefined, client });
  }

  return {
    providerName: useOllama ? 'ollama' : useLlm ? 'llm' : 'rules',
    async parse(text, ctx = {}) {
      const quick = quickMatch(text);
      if (quick) return quick;
      if (!llm) return parseWithRules(text, ctx);
      let result;
      try {
        result = await llm.parse(text, ctx);
      } catch (err) {
        logger?.warn?.('LLM parse failed, falling back to rules', { error: err?.message });
        return { ...parseWithRules(text, ctx), fallback: true };
      }
      if (result.intent === 'unknown' && result.confidence < 0.5) {
        const rules = parseWithRules(text, ctx);
        if (rules.intent !== 'unknown' && rules.confidence >= 0.9) return rules;
      }
      return result;
    },
  };
}
