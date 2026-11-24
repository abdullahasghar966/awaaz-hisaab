import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAdminRouter } from './routes/admin.js';
import { createDevRouter } from './routes/dev.js';
import { createWebhookRouter } from './routes/webhook.js';

// NOTE: static folders are resolved from this file, not from the current directory, so
// `npm start` works no matter where it is launched from.
const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

export function createApp(container) {
  const { config, services, pipeline, whatsapp, stt, nlp, logger } = container;
  const app = express();

  app.use(express.json({
    limit: '8mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }));

  // Landing route: send visitors to the simulator demo when it is enabled, else to the dashboard.
  app.get('/', (_req, res) => {
    res.redirect(302, config.devRoutes ? '/dev/simulator.html' : '/admin/');
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, providers: { whatsapp: whatsapp.name, stt: stt.name, nlp: nlp.providerName } });
  });

  app.use(createWebhookRouter({ config, pipeline, logger }));
  app.use(createAdminRouter({ services, config }));
  app.use('/admin', express.static(join(PUBLIC_DIR, 'admin')));

  if (config.devRoutes) {
    app.use(createDevRouter({ config, pipeline, whatsapp }));
    app.use('/dev', express.static(join(PUBLIC_DIR, 'dev')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    // Body-parser errors (bad JSON, too large) carry a 4xx status; everything else is a 500.
    const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) logger.error('unhandled route error', { error: err?.message, stack: err?.stack });
    res.status(status).json({ error: status === 500 ? 'internal' : 'bad_request' });
  });

  return app;
}
