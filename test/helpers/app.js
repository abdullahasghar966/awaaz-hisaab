import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createContainer } from '../../src/container.js';
import { createLogger } from '../../src/utils/logger.js';
import { fixedClock } from './clock.js';

// Starts the whole app on a random port with mocks. The config is built from an explicit env object,
// so a developer's real .env or shell variables can never leak into a test.
export async function startTestServer(envOverrides = {}, containerOverrides = {}) {
  const env = {
    DB_PATH: ':memory:',
    WHATSAPP_PROVIDER: 'mock',
    STT_PROVIDER: 'mock',
    NLP_PROVIDER: 'rules',
    DEV_ROUTES: 'true',
    ADMIN_TOKEN: 'test-token',
    WEBHOOK_AWAIT: 'true',
    DEV_AUDIO_DIR: 'test/fixtures/audio',
    LOG_LEVEL: 'error',
    ...envOverrides,
  };
  const config = loadConfig(env);
  const clock = containerOverrides.clock ?? fixedClock('2026-11-24T05:00:00Z');
  const container = createContainer(config, { clock, logger: createLogger('error'), ...containerOverrides });
  const app = createApp(container);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
  return { baseUrl, container, close, clock };
}

// POST /dev/simulate helper used by the e2e tests.
export async function simulate(baseUrl, body) {
  const res = await fetch(`${baseUrl}/dev/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
