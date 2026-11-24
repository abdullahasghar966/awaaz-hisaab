import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { normalizePhone } from '../utils/phone.js';

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

export function createDevRouter({ config, pipeline, whatsapp }) {
  const router = Router();

  router.post('/dev/simulate', async (req, res, next) => {
    try {
      const b = req.body ?? {};
      const from = normalizePhone(String(b.from ?? ''));
      if (!from) return res.status(400).json({ error: 'invalid_from' });

      const hasText = typeof b.text === 'string' && b.text.trim() !== '';
      const hasAudio = Boolean(b.audioPath || b.audioBase64);
      if (!hasText && !hasAudio) return res.status(400).json({ error: 'text_or_audio_required' });

      const inbound = {
        waMessageId: typeof b.messageId === 'string' && b.messageId ? b.messageId : 'dev-' + randomUUID(),
        from,
        type: 'text',
        text: null,
        mediaId: null,
        mimeType: null,
        profileName: typeof b.profileName === 'string' && b.profileName ? b.profileName : null,
        timestamp: Math.floor(Date.now() / 1000),
      };

      if (hasAudio) {
        inbound.type = 'audio';
        inbound.mimeType = typeof b.mimeType === 'string' && b.mimeType ? b.mimeType : 'audio/ogg';
        if (typeof b.transcript === 'string' && b.transcript.trim()) inbound.mockTranscript = b.transcript.trim();
        if (b.audioPath) {
          const base = path.resolve(config.devAudioDir);
          const full = path.resolve(base, String(b.audioPath));
          if (!full.startsWith(base + path.sep)) return res.status(400).json({ error: 'audio_path_outside_dir' });
          if (!existsSync(full) || !statSync(full).isFile()) return res.status(400).json({ error: 'audio_not_found' });
          inbound.audioPath = full;
        } else {
          const buffer = Buffer.from(String(b.audioBase64), 'base64');
          if (buffer.length > MAX_AUDIO_BYTES) return res.status(400).json({ error: 'audio_too_large' });
          inbound.audioBuffer = buffer;
        }
      } else {
        inbound.text = b.text;
      }

      const result = await pipeline.handleIncoming(inbound, { dryRun: true });
      return res.status(200).json(result);
    } catch (err) {
      return next(err);
    }
  });

  router.get('/dev/outbox', (_req, res) => res.json(whatsapp.outbox ?? []));
  router.post('/dev/outbox/reset', (_req, res) => {
    whatsapp.reset?.();
    res.json({ ok: true });
  });

  return router;
}
