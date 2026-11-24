// Claude integration (spec 6.9). The Anthropic client can be injected so tests never touch the network.
import Anthropic from '@anthropic-ai/sdk';
import { LLM_OUTPUT_SCHEMA, normalizeIntentResult } from './schema.js';

export const SYSTEM_PROMPT = `You extract structured bookkeeping commands from WhatsApp messages sent by small shopkeepers and traders in Pakistan. Messages are often speech-to-text transcripts and may be in Urdu script, Roman Urdu, Punjabi (Shahmukhi or Roman), Pashto, Sindhi, or English, with spelling mistakes and mixed languages. Return exactly one JSON object matching the schema.

Intents:
- record_sale: goods sold ("becha", "sale hui", "بیچا", "وپلوره", "وڪرو"). If sold on credit (udhaar), paymentMode="credit" and set contactName.
- record_purchase: goods bought ("khareeda", "خریدا", "واخیست"). On credit -> paymentMode="credit".
- record_expense: business expense (bills, rent/kiraya, salary/tankhwah, fuel, tea). Set category: electricity|rent|salary|food|fuel|transport|general.
- payment_received: a person paid money to the business or returned money ("Ahmed ne 5000 wapas kiye", "X se paise mil gaye").
- payment_made: the business paid a person/supplier ("Bilal ko 20 hazar ada kiye").
- credit_given: business lent money on udhaar ("Ahmed ko 2000 udhaar diya").
- credit_taken: business borrowed money ("Bilal se 50 hazar udhaar liya").
- add_staff: register an employee; needs staffName and staffPhone.
- assign_task: give work to a staff member ("Ali ko ... ka kaam do"); taskDescription is the work itself without the name, deadline or "kaam do".
- complete_task: report a task done ("task 3 ho gaya"); taskRef = task number if said.
- list_tasks: show tasks (optionally for one staffName).
- daily_summary: sales/expense report for a period ("aaj ki sale batao", "is mahine ka hisaab").
- balance_query: cash/galla/overall balance.
- contact_balance: how much a specific person owes or is owed ("Ahmed ka hisaab batao").
- undo_last: cancel/undo the last wrong entry.
- help, confirm (haan/ji/ok/ہاں/هو/ها), cancel (nahi/نہیں/نه), unknown (anything else; never guess a financial intent).

Rules:
- amount is in Pakistani rupees as a plain number. Convert number words: sau=100, hazar/hazaar/ہزار/زر/هزار=1000, lakh/لاکھ=100000, crore=10000000, dedh=1.5, dhai=2.5, sarhe X = X+0.5, sava X = X+0.25, paune X = X-0.25. "5k" = 5000. Urdu digits ۰-۹ are digits.
- A number followed by a unit (bori, kg, maund/man, piece, litre, dozen, carton, bag) is quantity, not amount.
- "X ne ... diye/wapas kiye" means X paid us (payment_received). "X ko ... diye" means we paid X (payment_made) unless it is udhaar (credit_given) or work (assign_task).
- For questions, "kal" means yesterday; for tasks, "kal" means tomorrow, "parson" = day after tomorrow, "aaj" = today. dueDate must be YYYY-MM-DD computed from Today.
- Prefer names from Known contacts / Known staff when they match (allow spelling and script variations; return the known spelling). Return names without particles (ne, ko, se, ka).
- staffPhone: digits only, Pakistani mobile like 923001234567 (convert 03xx to 923xx).
- language: the language/script of the message: ur (Urdu script), roman-ur (Urdu/Punjabi in Latin letters), pa (Punjabi Shahmukhi), ps (Pashto), sd (Sindhi), en (English).
- confidence: 0.9+ when clear, 0.5-0.8 when you had to guess, below 0.5 for unknown.
- Every field not mentioned in the message must be null. Never invent amounts or names.`;

export function buildUserMessage(text, ctx = {}) {
  const list = (a) => (Array.isArray(a) && a.length ? a.join(', ') : 'none');
  return `Today: ${ctx?.today ?? ''} (Asia/Karachi)\nKnown contacts: ${list(ctx?.knownContacts)}\nKnown staff: ${list(ctx?.knownStaff)}\nMessage: """${text}"""`;
}

export function createLlmParser({ apiKey, model = 'claude-haiku-5-5', timeoutMs = 15000, client = null } = {}) {
  let anthropic = client;
  return {
    name: 'llm',
    async parse(text, ctx = {}) {
      // Lazily created so building the parser without a key never throws.
      anthropic ??= new Anthropic({ apiKey, maxRetries: 1 });
      const res = await anthropic.messages.create({
        model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: LLM_OUTPUT_SCHEMA } },
        messages: [{ role: 'user', content: buildUserMessage(text, ctx) }],
      }, { timeout: timeoutMs });
      if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') throw new Error(`LLM_${res.stop_reason}`);
      const block = (res.content ?? []).find((b) => b.type === 'text');
      if (!block) throw new Error('LLM_NO_TEXT');
      return normalizeIntentResult(JSON.parse(block.text), 'llm');
    },
  };
}
