// Turns a Meta Cloud API webhook body into InboundMessage[]. Never throws: malformed input yields [].

function toTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseMessage(message, names) {
  if (!message || typeof message !== 'object') return null;

  const waMessageId = message.id ? String(message.id) : null;
  const from = message.from ? String(message.from) : null;
  if (!waMessageId || !from) return null;

  const base = {
    waMessageId,
    from,
    profileName: names.get(from) ?? null,
    timestamp: toTimestamp(message.timestamp),
  };

  // Text and interactive button replies both count as typed text.
  if (message.type === 'text' && typeof message.text?.body === 'string') {
    return { ...base, type: 'text', text: message.text.body, mediaId: null, mimeType: null };
  }
  if (message.type === 'interactive' && typeof message.interactive?.button_reply?.title === 'string') {
    return { ...base, type: 'text', text: message.interactive.button_reply.title, mediaId: null, mimeType: null };
  }
  // Voice notes arrive as type 'audio' (voice: true).
  if (message.type === 'audio' && message.audio?.id) {
    return {
      ...base,
      type: 'audio',
      text: null,
      mediaId: String(message.audio.id),
      mimeType: message.audio.mime_type ? String(message.audio.mime_type) : null,
    };
  }
  return { ...base, type: 'other', text: null, mediaId: null, mimeType: null };
}

export function parseWebhookPayload(body) {
  try {
    if (!body || typeof body !== 'object') return [];
    const out = [];

    for (const entry of Array.isArray(body.entry) ? body.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        if (change?.field !== 'messages') continue;
        const value = change.value ?? {};

        const names = new Map();
        for (const contact of Array.isArray(value.contacts) ? value.contacts : []) {
          if (contact?.wa_id) names.set(String(contact.wa_id), contact.profile?.name ?? null);
        }

        for (const message of Array.isArray(value.messages) ? value.messages : []) {
          const parsed = parseMessage(message, names);
          if (parsed) out.push(parsed);
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}
