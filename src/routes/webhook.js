import { Router } from 'express';
import { parseWebhookPayload } from '../whatsapp/parse.js';
import { verifySignature } from '../whatsapp/signature.js';

export function createWebhookRouter({ config, pipeline, logger }) {
  const router = Router();

  // Meta calls this once when you register the webhook URL.
  router.get('/webhook', (req, res) => {
    const token = config.whatsapp.verifyToken;
    if (req.query['hub.mode'] === 'subscribe' && token && req.query['hub.verify_token'] === token) {
      return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
    }
    return res.sendStatus(403);
  });

  // NOTE: messages of one delivery are processed one after another (not Promise.all) so a
  // "5000 ki sale" followed by "haan" in the same batch always sees the state the first one left.
  // Each message has its own catch, so nothing can become an unhandled rejection.
  async function processAll(messages) {
    let processed = 0;
    for (const m of messages) {
      try {
        await pipeline.handleIncoming(m);
        processed += 1;
      } catch (err) {
        logger?.error('webhook processing failed', { waMessageId: m.waMessageId, error: err?.message });
      }
    }
    return processed;
  }

  router.post('/webhook', async (req, res) => {
    const secret = config.whatsapp.appSecret;
    // NOTE: a real Meta number in production must be signed; otherwise anyone could post fake
    // messages and write entries into a business's books.
    if (!secret && config.whatsapp.provider === 'meta' && config.nodeEnv === 'production') {
      logger?.error('webhook rejected: set META_APP_SECRET to accept Meta webhooks in production');
      return res.sendStatus(401);
    }
    if (secret && !verifySignature(req.rawBody ?? Buffer.alloc(0), req.get('x-hub-signature-256'), secret)) {
      logger?.warn('webhook signature rejected');
      return res.sendStatus(401);
    }
    const messages = parseWebhookPayload(req.body);
    if (config.webhookAwait) {
      const processed = await processAll(messages);
      return res.status(200).json({ ok: true, processed });
    }
    res.status(200).json({ ok: true });
    processAll(messages).catch((err) => logger?.error('webhook background error', { error: err?.message }));
  });

  return router;
}
