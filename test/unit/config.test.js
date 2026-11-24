import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../../src/config.js';

test('defaults with an empty environment', () => {
  const c = loadConfig({});
  assert.equal(c.port, 3000);
  assert.equal(c.nodeEnv, 'development');
  assert.equal(c.dbPath, './data/app.db');
  assert.equal(c.timezone, 'Asia/Karachi');
  assert.equal(c.currency, 'PKR');
  assert.equal(c.autoRegister, true);
  assert.equal(c.devRoutes, true);
  assert.equal(c.adminToken, 'change-me');
  assert.equal(c.webhookAwait, false);
  assert.equal(c.logLevel, 'info');
  assert.equal(c.whatsapp.verifyToken, 'my-verify-token');
  assert.equal(c.whatsapp.graphVersion, 'v21.0');
  assert.equal(c.whatsapp.graphBaseUrl, 'https://graph.facebook.com');
  assert.equal(c.stt.model, 'whisper-1');
  assert.equal(c.stt.baseUrl, 'https://api.openai.com/v1');
  assert.equal(c.nlp.provider, 'auto');
  assert.equal(c.nlp.model, 'claude-haiku-5-5');
  assert.equal(c.nlp.timeoutMs, 15000);
  assert.equal(c.stt.localUrl, 'http://127.0.0.1:8080');
  assert.equal(c.nlp.ollamaUrl, 'http://127.0.0.1:11434');
  assert.equal(c.nlp.ollamaModel, 'qwen2.5:3b');
  assert.equal(c.nlp.ollamaTimeoutMs, 60000);
  assert.equal(c.confirm.amountThreshold, 50000);
  assert.equal(c.confirm.minConfidence, 0.6);
  assert.equal(c.confirm.ttlMinutes, 10);
});

test('devAudioDir is absolute', () => {
  const c = loadConfig({});
  assert.ok(/^([A-Za-z]:[\\/]|\/)/.test(c.devAudioDir), `not absolute: ${c.devAudioDir}`);
});

test('provider auto-selection without keys is mock/mock', () => {
  const c = loadConfig({});
  assert.equal(c.whatsapp.provider, 'mock');
  assert.equal(c.stt.provider, 'mock');
});

test('whatsapp provider becomes meta when token and phone id are set', () => {
  const c = loadConfig({ META_ACCESS_TOKEN: 'tok', META_PHONE_NUMBER_ID: '123' });
  assert.equal(c.whatsapp.provider, 'meta');
  assert.equal(c.whatsapp.accessToken, 'tok');
  assert.equal(c.whatsapp.phoneNumberId, '123');
});

test('whatsapp provider stays mock when only one of token/phone id is set', () => {
  assert.equal(loadConfig({ META_ACCESS_TOKEN: 'tok' }).whatsapp.provider, 'mock');
  assert.equal(loadConfig({ META_PHONE_NUMBER_ID: '123' }).whatsapp.provider, 'mock');
});

test('explicit WHATSAPP_PROVIDER wins over auto-selection', () => {
  const c = loadConfig({ WHATSAPP_PROVIDER: 'mock', META_ACCESS_TOKEN: 'tok', META_PHONE_NUMBER_ID: '123' });
  assert.equal(c.whatsapp.provider, 'mock');
});

test('stt provider becomes openai when OPENAI_API_KEY is set', () => {
  const c = loadConfig({ OPENAI_API_KEY: 'sk-test' });
  assert.equal(c.stt.provider, 'openai');
  assert.equal(c.stt.apiKey, 'sk-test');
});

test('explicit STT_PROVIDER wins over auto-selection', () => {
  assert.equal(loadConfig({ STT_PROVIDER: 'mock', OPENAI_API_KEY: 'sk-test' }).stt.provider, 'mock');
});

test('booleans: true, 1 and yes count as true; anything else is false', () => {
  for (const v of ['true', '1', 'yes', 'TRUE', 'Yes']) {
    assert.equal(loadConfig({ AUTO_REGISTER: v }).autoRegister, true, v);
  }
  for (const v of ['false', '0', 'no', 'off']) {
    assert.equal(loadConfig({ AUTO_REGISTER: v }).autoRegister, false, v);
  }
  assert.equal(loadConfig({ WEBHOOK_AWAIT: 'true' }).webhookAwait, true);
  assert.equal(loadConfig({ WEBHOOK_AWAIT: '1' }).webhookAwait, true);
});

test('devRoutes defaults to nodeEnv !== production', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production' }).devRoutes, false);
  assert.equal(loadConfig({ NODE_ENV: 'development' }).devRoutes, true);
  assert.equal(loadConfig({ NODE_ENV: 'production', DEV_ROUTES: 'true' }).devRoutes, true);
});

test('numeric values are parsed from env strings', () => {
  const c = loadConfig({ PORT: '8080', NLP_TIMEOUT_MS: '2500', CONFIRM_AMOUNT_THRESHOLD: '1000', CONFIRM_MIN_CONFIDENCE: '0.9' });
  assert.equal(c.port, 8080);
  assert.equal(c.nlp.timeoutMs, 2500);
  assert.equal(c.confirm.amountThreshold, 1000);
  assert.equal(c.confirm.minConfidence, 0.9);
});

test('an explicitly empty ADMIN_TOKEN stays empty (disables /api/admin)', () => {
  assert.equal(loadConfig({ ADMIN_TOKEN: '' }).adminToken, '');
  assert.equal(loadConfig({ ADMIN_TOKEN: 'secret' }).adminToken, 'secret');
});

test('the returned config is deeply frozen', () => {
  const c = loadConfig({});
  assert.equal(Object.isFrozen(c), true);
  assert.equal(Object.isFrozen(c.whatsapp), true);
  assert.equal(Object.isFrozen(c.confirm), true);
  assert.throws(() => {
    'use strict';
    c.port = 1;
  }, TypeError);
  assert.throws(() => {
    'use strict';
    c.whatsapp.provider = 'meta';
  }, TypeError);
  assert.equal(c.port, 3000);
});

test('local STT and Ollama settings come from env', () => {
  const c = loadConfig({
    STT_PROVIDER: 'whisper-local',
    STT_LOCAL_URL: 'http://192.168.1.5:8080',
    NLP_PROVIDER: 'ollama',
    OLLAMA_URL: 'http://127.0.0.1:9000',
    OLLAMA_MODEL: 'llama3.2:3b',
    OLLAMA_TIMEOUT_MS: '90000',
  });
  assert.equal(c.stt.provider, 'whisper-local');
  assert.equal(c.stt.localUrl, 'http://192.168.1.5:8080');
  assert.equal(c.nlp.provider, 'ollama');
  assert.equal(c.nlp.ollamaUrl, 'http://127.0.0.1:9000');
  assert.equal(c.nlp.ollamaModel, 'llama3.2:3b');
  assert.equal(c.nlp.ollamaTimeoutMs, 90000);
});

test('blank local STT and Ollama values fall back to defaults', () => {
  const c = loadConfig({ STT_LOCAL_URL: '  ', OLLAMA_URL: '', OLLAMA_MODEL: '', OLLAMA_TIMEOUT_MS: 'abc' });
  assert.equal(c.stt.localUrl, 'http://127.0.0.1:8080');
  assert.equal(c.nlp.ollamaUrl, 'http://127.0.0.1:11434');
  assert.equal(c.nlp.ollamaModel, 'qwen2.5:3b');
  assert.equal(c.nlp.ollamaTimeoutMs, 60000);
});

test('STT_PROVIDER stays explicit: whisper-local is not chosen automatically', () => {
  assert.equal(loadConfig({ OPENAI_API_KEY: 'sk-test' }).stt.provider, 'openai');
  assert.equal(loadConfig({ STT_LOCAL_URL: 'http://127.0.0.1:8080' }).stt.provider, 'mock');
});

test('8 GB defaults: qwen2.5:3b, 2048-token context, 10 minute keep_alive', () => {
  const c = loadConfig({});
  assert.equal(c.nlp.ollamaModel, 'qwen2.5:3b');
  assert.equal(c.nlp.ollamaNumCtx, 2048);
  assert.equal(c.nlp.ollamaKeepAlive, '10m');
});

test('OLLAMA_NUM_CTX and OLLAMA_KEEP_ALIVE come from env; bad numbers fall back', () => {
  const c = loadConfig({ OLLAMA_NUM_CTX: '4096', OLLAMA_KEEP_ALIVE: '0' });
  assert.equal(c.nlp.ollamaNumCtx, 4096);
  assert.equal(c.nlp.ollamaKeepAlive, '0');
  assert.equal(loadConfig({ OLLAMA_NUM_CTX: 'lots', OLLAMA_KEEP_ALIVE: '  ' }).nlp.ollamaNumCtx, 2048);
  assert.equal(loadConfig({ OLLAMA_KEEP_ALIVE: '  ' }).nlp.ollamaKeepAlive, '10m');
});

test('VERCEL: default dbPath is /tmp/app.db, explicit DB_PATH still wins', () => {
  assert.equal(loadConfig({ VERCEL: '1' }).dbPath, '/tmp/app.db');
  assert.equal(loadConfig({ VERCEL: '1', DB_PATH: '/tmp/other.db' }).dbPath, '/tmp/other.db');
  assert.equal(loadConfig({}).dbPath, './data/app.db');
});

test('VERCEL: webhookAwait defaults to true, explicit WEBHOOK_AWAIT still wins', () => {
  assert.equal(loadConfig({ VERCEL: '1' }).webhookAwait, true);
  assert.equal(loadConfig({ VERCEL: '1', WEBHOOK_AWAIT: 'false' }).webhookAwait, false);
  assert.equal(loadConfig({}).webhookAwait, false);
});

test('production (NODE_ENV or VERCEL): unset or change-me ADMIN_TOKEN becomes empty', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production' }).adminToken, '');
  assert.equal(loadConfig({ NODE_ENV: 'production', ADMIN_TOKEN: 'change-me' }).adminToken, '');
  assert.equal(loadConfig({ VERCEL: '1' }).adminToken, '');
  assert.equal(loadConfig({ VERCEL: '1', ADMIN_TOKEN: 'change-me' }).adminToken, '');
});

test('production: a real ADMIN_TOKEN is kept', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production', ADMIN_TOKEN: 'long-secret' }).adminToken, 'long-secret');
  assert.equal(loadConfig({ VERCEL: '1', ADMIN_TOKEN: ' long-secret ' }).adminToken, 'long-secret');
});

test('local development keeps the change-me default when unset', () => {
  assert.equal(loadConfig({ NODE_ENV: 'development' }).adminToken, 'change-me');
  assert.equal(loadConfig({}).adminToken, 'change-me');
  assert.equal(loadConfig({ NODE_ENV: 'development', ADMIN_TOKEN: 'change-me' }).adminToken, 'change-me');
});
