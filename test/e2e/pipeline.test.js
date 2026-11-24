import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from '../helpers/app.js';
import { createPipeline } from '../../src/pipeline/orchestrator.js';

const OWNER = '923001112222';
const STAFF = '923001234567';

describe('pipeline (mocks, in-memory DB)', () => {
  let srv;
  let pipeline;
  let services;
  let seq;

  const send = (from, text, extra = {}) =>
    pipeline.handleIncoming({
      waMessageId: `m-${++seq}`, from, type: 'text', text, mediaId: null, mimeType: null, profileName: null, timestamp: 1, ...extra,
    });
  const ownerUser = () => services.businesses.findUserByPhone(OWNER);

  beforeEach(async () => {
    seq = 0;
    srv = await startTestServer();
    pipeline = srv.container.pipeline;
    services = srv.container.services;
  });
  afterEach(() => srv.close());

  it('registers a new number as owner and sends a welcome first', async () => {
    const r = await send(OWNER, 'aaj 5000 ki sale hui');
    assert.equal(r.status, 'processed');
    assert.deepEqual(r.replies.map((x) => x.key), ['welcome', 'sale_recorded']);
    assert.equal(ownerUser().role, 'owner');
    assert.equal(services.ledger.getBalances(ownerUser().businessId).cash, 5000);
  });

  it('sends only the welcome for a bare greeting from a new user', async () => {
    const r = await send(OWNER, 'hello');
    assert.deepEqual(r.replies.map((x) => x.key), ['welcome']);
  });

  it('replies in Urdu script to an Urdu message', async () => {
    await send(OWNER, 'help');
    const r = await send(OWNER, 'آج پانچ ہزار کی سیل ہوئی');
    assert.equal(r.language, 'ur');
    assert.equal(r.replies[0].key, 'sale_recorded');
    assert.match(r.replies[0].text, /[؀-ۿ]/);
  });

  it('processes a duplicate waMessageId only once', async () => {
    const msg = { waMessageId: 'same', from: OWNER, type: 'text', text: 'aaj 100 ki sale hui' };
    const a = await pipeline.handleIncoming(msg);
    const b = await pipeline.handleIncoming(msg);
    assert.equal(a.status, 'processed');
    assert.equal(b.status, 'duplicate');
    assert.deepEqual(b.replies, []);
    assert.equal(services.ledger.listTransactions(ownerUser().businessId, {}).length, 1);
  });

  it('handles audio through whatsapp.registerMedia + mockTranscript', async () => {
    srv.container.whatsapp.registerMedia('media-1', {
      buffer: Buffer.from('x'), mimeType: 'audio/ogg', mockTranscript: 'aaj 700 ki sale hui',
    });
    const r = await send(OWNER, null, { type: 'audio', mediaId: 'media-1' });
    assert.equal(r.transcript, 'aaj 700 ki sale hui');
    assert.equal(r.intent, 'record_sale');
    assert.equal(services.ledger.getBalances(ownerUser().businessId).cash, 700);
    // the real (non-dry-run) path sends through the WhatsApp client
    assert.equal(srv.container.whatsapp.outbox.length, r.replies.length);
  });

  it('answers stt_not_configured when the mock STT has no transcript', async () => {
    srv.container.whatsapp.registerMedia('media-2', { buffer: Buffer.from('no transcript here'), mimeType: 'audio/ogg' });
    const r = await send(OWNER, null, { type: 'audio', mediaId: 'media-2' });
    assert.equal(r.status, 'error');
    assert.equal(r.replies.at(-1).key, 'stt_not_configured');
  });

  it('answers transcription_failed when a real STT provider throws', async () => {
    const failing = { name: 'openai', transcribe: async () => { throw new Error('STT_HTTP_429'); } };
    const pipe = createPipeline({ config: srv.container.config, services, nlp: srv.container.nlp, stt: failing, whatsapp: srv.container.whatsapp, logger: null, clock: srv.container.clock });
    srv.container.whatsapp.registerMedia('media-3', { buffer: Buffer.from('x'), mimeType: 'audio/ogg' });
    const r = await pipe.handleIncoming({ waMessageId: 'm-audio-3', from: OWNER, type: 'audio', text: null, mediaId: 'media-3', mimeType: null, profileName: null, timestamp: 1 });
    assert.equal(r.replies.at(-1).key, 'transcription_failed');
  });

  it('asks for confirmation on a large amount, executes on haan, then nothing_to_confirm', async () => {
    await send(OWNER, 'help');
    const ask = await send(OWNER, 'aaj 60000 ki sale hui');
    assert.equal(ask.replies[0].key, 'confirm_request');
    assert.equal(services.ledger.getBalances(ownerUser().businessId).cash, 0);
    const yes = await send(OWNER, 'haan');
    assert.equal(yes.replies[0].key, 'sale_recorded');
    assert.equal(services.ledger.getBalances(ownerUser().businessId).cash, 60000);
    const again = await send(OWNER, 'haan');
    assert.equal(again.replies[0].key, 'nothing_to_confirm');
  });

  it('cancels a pending confirmation on nahi', async () => {
    await send(OWNER, 'help');
    await send(OWNER, 'aaj 60000 ki sale hui');
    const no = await send(OWNER, 'nahi');
    assert.equal(no.replies[0].key, 'cancelled');
    assert.equal(services.ledger.getBalances(ownerUser().businessId).cash, 0);
    assert.equal((await send(OWNER, 'haan')).replies[0].key, 'nothing_to_confirm');
  });

  it('discards a pending confirmation when a new command arrives', async () => {
    await send(OWNER, 'help');
    await send(OWNER, 'aaj 60000 ki sale hui');
    const other = await send(OWNER, 'aaj 100 ki sale hui');
    assert.equal(other.replies[0].key, 'sale_recorded');
    assert.equal((await send(OWNER, 'haan')).replies[0].key, 'nothing_to_confirm');
    assert.equal(services.ledger.getBalances(ownerUser().businessId).cash, 100);
  });

  it('asks for missing info when the amount is absent', async () => {
    await send(OWNER, 'help');
    const r = await send(OWNER, 'Ahmed ne wapas kiye');
    assert.equal(r.replies[0].key, 'missing_info');
  });

  it('runs the staff flow: add staff, assign, notify, complete, notify owner, permissions', async () => {
    await send(OWNER, 'help');
    const add = await send(OWNER, 'Kamran ko staff mein add karo 0300-1234567');
    assert.equal(add.replies[0].key, 'staff_added');

    const assign = await send(OWNER, 'Kamran ko kal tak 50 bori cement deliver karne ka kaam do');
    assert.equal(assign.replies[0].key, 'task_assigned');
    assert.equal(assign.replies[0].to, OWNER);
    const note = assign.replies.find((x) => x.key === 'task_notification');
    assert.equal(note.to, STAFF);

    const staffBalance = await send(STAFF, 'balance batao');
    assert.equal(staffBalance.replies[0].key, 'permission_denied');

    const done = await send(STAFF, 'kaam ho gaya');
    assert.equal(done.replies[0].key, 'task_completed');
    const notice = done.replies.find((x) => x.key === 'task_completed_owner_notice');
    assert.equal(notice.to, OWNER);
  });

  it('undo flow asks for confirmation, then voids the last entry', async () => {
    await send(OWNER, 'aaj 500 ki sale hui');
    const ask = await send(OWNER, 'aakhri entry hatao');
    assert.equal(ask.replies[0].key, 'confirm_request');
    const yes = await send(OWNER, 'haan');
    assert.equal(yes.replies[0].key, 'undo_done');
    assert.equal(services.ledger.getBalances(ownerUser().businessId).cash, 0);
  });

  it('answers unknown text with unknown', async () => {
    await send(OWNER, 'help');
    const r = await send(OWNER, 'mausam kaisa hai');
    assert.equal(r.replies[0].key, 'unknown');
  });

  it('answers unsupported_message for non text/audio types', async () => {
    const r = await send(OWNER, null, { type: 'other' });
    assert.equal(r.status, 'ignored');
    assert.equal(r.replies.at(-1).key, 'unsupported_message');
  });

  it('ignores unknown numbers with not_registered when AUTO_REGISTER=false', async () => {
    const closed = await startTestServer({ AUTO_REGISTER: 'false' });
    try {
      const r = await closed.container.pipeline.handleIncoming({ waMessageId: 'x1', from: OWNER, type: 'text', text: 'help' });
      assert.equal(r.status, 'ignored');
      assert.equal(r.replies[0].key, 'not_registered');
    } finally {
      await closed.close();
    }
  });

  it('turns an unexpected exception into an error reply', async () => {
    await send(OWNER, 'help');
    srv.container.services.ledger.recordSale = () => { throw new Error('boom'); };
    const r = await send(OWNER, 'aaj 100 ki sale hui');
    assert.equal(r.status, 'error');
    assert.equal(r.replies[0].key, 'error');
  });
});
