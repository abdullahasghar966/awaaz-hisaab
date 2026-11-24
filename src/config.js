import { resolve } from 'node:path';

// Parse a boolean env value: 'true' | '1' | 'yes' (case-insensitive) count as true.
function toBool(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return ['true', '1', 'yes'].includes(String(value).trim().toLowerCase());
}

// Parse a number env value; blank or non-numeric falls back to the default.
function toNum(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

// Blank or missing string env value falls back to the default.
function toStr(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value).trim();
}

// Admin token rules:
// - Local development (not production, not Vercel): an unset ADMIN_TOKEN defaults to 'change-me'.
// - Production or Vercel: an unset or 'change-me' token becomes '' (empty disables /api/admin).
// - An explicitly set token always wins. An explicitly empty token stays empty.
// Empty tokens are rejected by src/routes/admin.js with 503 (no request is ever allowed through).
function resolveAdminToken(env, isProduction) {
  if (env.ADMIN_TOKEN === undefined) return isProduction ? '' : 'change-me';
  const token = String(env.ADMIN_TOKEN).trim();
  if (isProduction && token === 'change-me') return '';
  return token;
}

function deepFreeze(obj) {
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') deepFreeze(value);
  }
  return Object.freeze(obj);
}

export function loadConfig(env = process.env) {
  const nodeEnv = toStr(env.NODE_ENV, 'development');
  // Vercel sets VERCEL=1 on every deployment (serverless: only /tmp is writable, background work is killed).
  const onVercel = toStr(env.VERCEL, '') !== '';
  const isProduction = nodeEnv === 'production' || onVercel;

  const whatsappAccessToken = toStr(env.META_ACCESS_TOKEN, '');
  const whatsappPhoneNumberId = toStr(env.META_PHONE_NUMBER_ID, '');
  const whatsappProvider = toStr(
    env.WHATSAPP_PROVIDER,
    whatsappAccessToken && whatsappPhoneNumberId ? 'meta' : 'mock',
  );

  const openaiKey = toStr(env.OPENAI_API_KEY, '');
  const sttProvider = toStr(env.STT_PROVIDER, openaiKey ? 'openai' : 'mock');

  const config = {
    port: toNum(env.PORT, 3000),
    nodeEnv,
    // On Vercel the only writable location is /tmp, so the default DB lives there (data resets on cold start).
    dbPath: toStr(env.DB_PATH, onVercel ? '/tmp/app.db' : './data/app.db'),
    timezone: toStr(env.TIMEZONE, 'Asia/Karachi'),
    currency: 'PKR',
    autoRegister: toBool(env.AUTO_REGISTER, true),
    devRoutes: toBool(env.DEV_ROUTES, nodeEnv !== 'production'),
    devAudioDir: resolve(toStr(env.DEV_AUDIO_DIR, './samples')),
    adminToken: resolveAdminToken(env, isProduction),
    // Serverless functions are frozen after the response, so background webhook work must finish first.
    webhookAwait: toBool(env.WEBHOOK_AWAIT, onVercel),
    logLevel: toStr(env.LOG_LEVEL, 'info'),
    whatsapp: {
      provider: whatsappProvider,
      verifyToken: toStr(env.META_VERIFY_TOKEN, 'my-verify-token'),
      appSecret: toStr(env.META_APP_SECRET, ''),
      accessToken: whatsappAccessToken,
      phoneNumberId: whatsappPhoneNumberId,
      graphVersion: toStr(env.META_GRAPH_VERSION, 'v21.0'),
      graphBaseUrl: toStr(env.META_GRAPH_BASE_URL, 'https://graph.facebook.com'),
    },
    stt: {
      provider: sttProvider,
      apiKey: openaiKey,
      model: toStr(env.STT_MODEL, 'whisper-1'),
      language: toStr(env.STT_LANGUAGE, ''),
      baseUrl: toStr(env.OPENAI_BASE_URL, 'https://api.openai.com/v1'),
      localUrl: toStr(env.STT_LOCAL_URL, 'http://127.0.0.1:8080'),
    },
    nlp: {
      provider: toStr(env.NLP_PROVIDER, 'auto'),
      apiKey: toStr(env.ANTHROPIC_API_KEY, ''),
      model: toStr(env.NLP_MODEL, 'claude-haiku-5-5'),
      timeoutMs: toNum(env.NLP_TIMEOUT_MS, 15000),
      ollamaUrl: toStr(env.OLLAMA_URL, 'http://127.0.0.1:11434'),
      ollamaModel: toStr(env.OLLAMA_MODEL, 'qwen2.5:3b'),
      ollamaTimeoutMs: toNum(env.OLLAMA_TIMEOUT_MS, 60000),
      // Context window in tokens. 2048 fits the system prompt, few-shots and a reply, and keeps RAM low.
      ollamaNumCtx: toNum(env.OLLAMA_NUM_CTX, 2048),
      // How long Ollama keeps the model loaded after the last request ('10m', '0' = unload at once, '-1' = never).
      ollamaKeepAlive: toStr(env.OLLAMA_KEEP_ALIVE, '10m'),
    },
    confirm: {
      amountThreshold: toNum(env.CONFIRM_AMOUNT_THRESHOLD, 50000),
      minConfidence: toNum(env.CONFIRM_MIN_CONFIDENCE, 0.6),
      ttlMinutes: toNum(env.CONFIRM_TTL_MINUTES, 10),
    },
  };

  return deepFreeze(config);
}
