// The message pipeline (spec 6.15): dedupe -> identify -> media -> STT -> language -> NLP -> confirm -> execute -> reply.
import { readFile } from 'node:fs/promises';
import { detectLanguage } from '../lang/detect.js';
import { validateIntent } from '../nlp/schema.js';
import { composeReply } from '../replies/index.js';
import { tokenize } from '../utils/text.js';
import { todayLocal } from '../utils/time.js';
import { createHandlers, isAllowed, needsConfirmation } from './handlers.js';

export function createPipeline({ config, services, nlp, stt, whatsapp, logger, clock }) {
  const { messages, businesses, contacts, confirmations } = services;
  const handlers = createHandlers({ services, config });

  async function loadAudio(inbound) {
    let buffer = inbound.audioBuffer ?? null;
    let mimeType = inbound.mimeType ?? null;
    let mockTranscript = inbound.mockTranscript ?? null;
    if (!buffer && inbound.audioPath) buffer = await readFile(inbound.audioPath);
    if (!buffer && inbound.mediaId) {
      const media = await whatsapp.downloadMedia(inbound.mediaId);
      buffer = media.buffer;
      mimeType = media.mimeType ?? mimeType;
      mockTranscript = mockTranscript ?? media.mockTranscript ?? null;
    }
    return { buffer, mimeType, mockTranscript };
  }

  async function handleIncoming(inbound, { dryRun = false } = {}) {
    const out = { status: 'processed', intent: null, transcript: null, language: null, replies: [] };

    // 1 dedupe (synchronous, so two deliveries of the same id can never both pass)
    const { id: msgId, duplicate } = messages.recordInbound({
      waMessageId: inbound.waMessageId ?? null,
      phone: inbound.from,
      msgType: inbound.type,
      body: inbound.text ?? null,
      mediaId: inbound.mediaId ?? null,
    });
    if (duplicate) return { ...out, status: 'duplicate' };

    let user = null;
    let businessId = null;

    // Replies are queued while processing; flush() sends and logs them in order.
    const queued = [];
    const queue = (to, key, data, lang) => {
      queued.push({ to, key, text: composeReply(key, data, lang), businessId });
    };

    async function flush(status) {
      for (const r of queued) {
        let outStatus = 'simulated';
        let error = null;
        let waMessageId = null;
        if (!dryRun) {
          let res;
          try {
            res = await whatsapp.sendText(r.to, r.text);
          } catch (err) {
            res = { ok: false, error: err.message };
          }
          outStatus = res.ok ? 'sent' : 'failed';
          error = res.ok ? null : (res.error ?? 'send_failed');
          waMessageId = res.messageId ?? null;
        }
        messages.recordOutbound({
          phone: r.to, body: r.text, businessId: r.businessId, waMessageId, status: outStatus, error, inReplyTo: msgId,
        });
        out.replies.push({ to: r.to, text: r.text, key: r.key });
      }
      queued.length = 0;
      out.status = status;
      messages.updateInbound(msgId, { status });
      return out;
    }

    try {
      // 2 identify
      user = businesses.findUserByPhone(inbound.from);
      let isNew = false;
      if (!user) {
        if (!config.autoRegister) {
          queue(inbound.from, 'not_registered', {}, 'roman-ur');
          return await flush('ignored');
        }
        user = businesses.registerOwner({ phone: inbound.from, name: inbound.profileName ?? null });
        isNew = true;
      }
      businessId = user.businessId;
      messages.updateInbound(msgId, { businessId });
      const to = inbound.from;

      // 3 unsupported message types
      if (inbound.type === 'other') {
        queue(to, 'unsupported_message', {}, user.language);
        return await flush('ignored');
      }

      // 4 text, or media -> STT
      let text = inbound.text ?? '';
      let sttLanguage = null;
      if (inbound.type === 'audio') {
        try {
          const media = await loadAudio(inbound);
          const res = await stt.transcribe({
            buffer: media.buffer,
            mimeType: media.mimeType ?? 'audio/ogg',
            sourcePath: inbound.audioPath ?? null,
            mockTranscript: media.mockTranscript,
          });
          text = res.text ?? '';
          sttLanguage = res.language ?? null;
        } catch (err) {
          logger?.warn('transcription failed', { error: err.message });
          messages.updateInbound(msgId, { error: err.message });
          queue(to, 'transcription_failed', {}, user.language);
          return await flush('error');
        }
      }
      out.transcript = text;

      // 5 language
      const lang = detectLanguage(text, { sttLanguage });
      out.language = lang;
      businesses.setUserLanguage(user.id, lang);

      // 6 welcome for a brand-new owner
      if (isNew) queue(to, 'welcome', { name: user.name, businessName: user.businessName }, lang);

      // 7 NLP
      const nlpCtx = {
        today: todayLocal(config.timezone, clock.now()),
        knownContacts: contacts.names(businessId),
        knownStaff: businesses.listStaff(businessId).map((u) => u.name),
      };
      let result = await nlp.parse(text, nlpCtx);
      out.intent = result.intent;
      messages.updateInbound(msgId, {
        businessId, transcript: text, language: lang, intent: result.intent, intentJson: JSON.stringify(result),
      });

      // A bare greeting from a new user only gets the welcome.
      if (isNew && tokenize(text).length <= 2 && (result.intent === 'unknown' || result.intent === 'help')) {
        return await flush('processed');
      }

      // 8 pending confirmation
      const pending = confirmations.getActive(user.id);
      let confirmed = false;
      if (result.intent === 'confirm' || result.intent === 'cancel') {
        if (!pending) {
          queue(to, 'nothing_to_confirm', {}, lang);
          return await flush('processed');
        }
        confirmations.clear(user.id);
        if (result.intent === 'cancel') {
          queue(to, 'cancelled', {}, lang);
          return await flush('processed');
        }
        result = pending.intentResult;
        out.intent = result.intent;
        confirmed = true;
      } else if (pending) {
        confirmations.clear(user.id);
      }

      if (!confirmed) {
        // 9 validate
        const v = validateIntent(result);
        if (!v.ok) {
          queue(to, 'missing_info', { intent: result.intent, missing: v.missing }, lang);
          return await flush('processed');
        }
        // 10 permission, then confirmation
        if (!isAllowed(user.role, result.intent)) {
          queue(to, 'permission_denied', {}, lang);
          return await flush('processed');
        }
        if (needsConfirmation(result, config.confirm)) {
          confirmations.create({ businessId, userId: user.id, sourceMessageId: msgId }, result);
          const e = result.entities;
          queue(to, 'confirm_request', {
            intent: result.intent, amount: e.amount, contactName: e.contactName, staffName: e.staffName, description: e.taskDescription,
          }, lang);
          return await flush('processed');
        }
      }

      // 11 execute, 12 compose (+ notifications in each recipient's own language)
      const hr = await handlers.execute(result, { user, sourceMessageId: msgId });
      queue(to, hr.key, hr.data, lang);
      for (const n of hr.notify ?? []) {
        const target = businesses.getUserById(n.userId);
        if (!target?.phone) continue;
        queue(target.phone, n.key, n.data, target.language);
      }
      // 13-14 send and log
      return await flush('processed');
    } catch (err) {
      logger?.error('pipeline error', { error: err.message, stack: err.stack });
      try {
        messages.updateInbound(msgId, { error: err.message });
        queued.length = 0;
        queue(inbound.from, 'error', {}, user?.language ?? 'roman-ur');
        return await flush('error');
      } catch (inner) {
        logger?.error('pipeline error reply failed', { error: inner.message });
        return { ...out, status: 'error' };
      }
    }
  }

  return { handleIncoming };
}
