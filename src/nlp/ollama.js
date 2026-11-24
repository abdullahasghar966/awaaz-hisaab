// Self-hosted Ollama parser: same contract as the Claude parser (llm.js), same schema and normalisation.
import { LLM_OUTPUT_SCHEMA, normalizeIntentResult } from './schema.js';
import { SYSTEM_PROMPT, buildUserMessage } from './llm.js';

const OLLAMA_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

Output format: reply with ONLY one JSON object containing ALL of these keys: intent, language, confidence, amount, quantity, unit, item, contactName, paymentMode, category, staffName, staffPhone, taskDescription, dueDate, taskRef, period, note. Use null for anything not stated. amount and quantity are JSON numbers, never strings. Keep names in the script they were spoken in unless a Known contact/staff matches.`;

const NULLS = { quantity: null, unit: null, item: null, contactName: null, paymentMode: null, category: null,
  staffName: null, staffPhone: null, taskDescription: null, dueDate: null, taskRef: null, period: null, note: null };
const ex = (o) => JSON.stringify({ amount: null, ...NULLS, ...o });

const EXAMPLE_CTX = { today: '2026-11-24', knownContacts: ['Ahmed'], knownStaff: ['Ali'] };

// Few-shot turns: Roman Urdu, Urdu script, Pashto, Roman Urdu with credit.
export const FEW_SHOT = [
  ['aaj 5 hazar ka maal becha', ex({ intent: 'record_sale', language: 'roman-ur', confidence: 0.95, amount: 5000, paymentMode: 'cash' })],
  ['احمد کو دو ہزار ادھار دیا', ex({ intent: 'credit_given', language: 'ur', confidence: 0.94, amount: 2000, contactName: 'Ahmed', paymentMode: 'credit' })],
  ['نن مې درې زره روپۍ پلورل', ex({ intent: 'record_sale', language: 'ps', confidence: 0.9, amount: 3000, paymentMode: 'cash' })],
  ['Ali ko kal dukan saaf karne ka kaam do', ex({ intent: 'assign_task', language: 'roman-ur', confidence: 0.92, staffName: 'Ali', taskDescription: 'dukan saaf karna', dueDate: '2026-11-25' })],
];

export function buildMessages(text, ctx = {}) {
  const messages = [{ role: 'system', content: OLLAMA_SYSTEM_PROMPT }];
  for (const [q, a] of FEW_SHOT) {
    messages.push({ role: 'user', content: buildUserMessage(q, EXAMPLE_CTX) }, { role: 'assistant', content: a });
  }
  messages.push({ role: 'user', content: buildUserMessage(text, ctx) });
  return messages;
}

// Memory-saving defaults for 8 GB PCs: a small context window, deterministic output and a model
// that unloads after `keepAlive` of inactivity (it stays loaded between messages in a conversation).
export function createOllamaParser({
  url = 'http://127.0.0.1:11434',
  model = 'qwen2.5:3b',
  timeoutMs = 60000,
  numCtx = 2048,
  keepAlive = '10m',
  fetchImpl = fetch,
} = {}) {
  const endpoint = `${String(url).replace(/\/+$/, '')}/api/chat`;
  return {
    name: 'ollama',
    async parse(text, ctx = {}) {
      let res;
      try {
        res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            stream: false,
            format: LLM_OUTPUT_SCHEMA,
            keep_alive: keepAlive,
            options: { temperature: 0, num_ctx: numCtx },
            messages: buildMessages(text, ctx),
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        throw new Error(`OLLAMA_UNREACHABLE: ${err?.message ?? err}`);
      }
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
        throw new Error(`OLLAMA_HTTP_${res.status}${detail ? `: ${detail}` : ''}`);
      }
      let body;
      try { body = await res.json(); } catch { throw new Error('OLLAMA_BAD_RESPONSE'); }
      const content = body?.message?.content;
      if (typeof content !== 'string' || !content.trim()) throw new Error('OLLAMA_NO_CONTENT');
      let parsed;
      try { parsed = JSON.parse(content); } catch { throw new Error('OLLAMA_INVALID_JSON'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('OLLAMA_INVALID_JSON');
      return normalizeIntentResult(parsed, 'llm');
    },
  };
}
