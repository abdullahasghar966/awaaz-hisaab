// WhatsApp Cloud API client (Meta) and an in-memory mock. Both expose the same interface:
// { name, sendText(to, body), downloadMedia(mediaId) }. The mock also has outbox, registerMedia, reset.

const MAX_BODY = 4000;
const TRUNCATED = 3990;

function truncateBody(body) {
  const text = String(body ?? '');
  return text.length > MAX_BODY ? text.slice(0, TRUNCATED) + '…' : text;
}

function createMetaClient(waConfig, { fetchImpl, logger }) {
  if (!waConfig.accessToken || !waConfig.phoneNumberId) {
    throw new Error('WHATSAPP_CONFIG_MISSING: META_ACCESS_TOKEN and META_PHONE_NUMBER_ID are required');
  }
  const base = `${waConfig.graphBaseUrl}/${waConfig.graphVersion}`;
  const auth = { Authorization: `Bearer ${waConfig.accessToken}` };

  return {
    name: 'meta',

    // Never throws: failures come back as { ok: false, error }.
    async sendText(to, body) {
      try {
        const res = await fetchImpl(`${base}/${waConfig.phoneNumberId}/messages`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { preview_url: false, body: truncateBody(body) },
          }),
        });
        if (!res.ok) {
          let detail = '';
          try {
            detail = typeof res.text === 'function' ? await res.text() : '';
          } catch {
            detail = '';
          }
          logger?.warn('whatsapp send failed', { status: res.status, detail });
          return { ok: false, messageId: null, error: `WA_HTTP_${res.status}` };
        }
        const json = await res.json();
        return { ok: true, messageId: json.messages?.[0]?.id ?? null };
      } catch (err) {
        logger?.error('whatsapp send error', { message: err.message });
        return { ok: false, messageId: null, error: err.message };
      }
    },

    // Two steps: resolve the media URL, then download the bytes. Errors propagate to the caller.
    async downloadMedia(mediaId) {
      const metaRes = await fetchImpl(`${base}/${encodeURIComponent(mediaId)}`, { headers: auth });
      if (!metaRes.ok) throw new Error(`WA_MEDIA_HTTP_${metaRes.status}`);
      const info = await metaRes.json();

      const fileRes = await fetchImpl(info.url, { headers: auth });
      if (!fileRes.ok) throw new Error(`WA_MEDIA_HTTP_${fileRes.status}`);
      return {
        buffer: Buffer.from(await fileRes.arrayBuffer()),
        mimeType: info.mime_type ?? null,
      };
    },
  };
}

function createMockWhatsApp({ logger, clock }) {
  const outbox = [];
  const media = new Map();
  let counter = 0;

  return {
    name: 'mock',
    outbox,

    async sendText(to, body) {
      counter += 1;
      const at = (clock ? clock.now() : new Date()).toISOString();
      outbox.push({ to, body: String(body ?? ''), at });
      logger?.debug('mock whatsapp send', { to });
      return { ok: true, messageId: 'mock-' + counter };
    },

    async downloadMedia(mediaId) {
      const entry = media.get(mediaId);
      if (!entry) throw new Error('MEDIA_NOT_FOUND');
      return {
        buffer: entry.buffer,
        mimeType: entry.mimeType,
        ...(entry.mockTranscript ? { mockTranscript: entry.mockTranscript } : {}),
      };
    },

    registerMedia(mediaId, { buffer = Buffer.alloc(0), mimeType = null, mockTranscript } = {}) {
      media.set(mediaId, { buffer, mimeType, mockTranscript });
    },

    // Clears in place so that anyone holding the outbox array sees the reset.
    reset() {
      outbox.length = 0;
      media.clear();
    },
  };
}

export function createWhatsAppClient(waConfig, { fetchImpl = fetch, logger, clock } = {}) {
  if (waConfig.provider === 'meta') return createMetaClient(waConfig, { fetchImpl, logger });
  if (waConfig.provider === 'mock') return createMockWhatsApp({ logger, clock });
  throw new Error(`Unknown WhatsApp provider: ${waConfig.provider}`);
}
