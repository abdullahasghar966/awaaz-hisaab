import { openDatabase } from './db/index.js';
import { createServices } from './domain/index.js';
import { createNlp } from './nlp/index.js';
import { createPipeline } from './pipeline/orchestrator.js';
import { createStt } from './stt/index.js';
import { createLogger } from './utils/logger.js';
import { createWhatsAppClient } from './whatsapp/client.js';

// Wires everything together. Tests pass overrides (clock, db, stt, nlp, whatsapp, logger, fetchImpl, llmClient).
export function createContainer(config, overrides = {}) {
  const clock = overrides.clock ?? { now: () => new Date() };
  const logger = overrides.logger ?? createLogger(config.logLevel);
  const fetchImpl = overrides.fetchImpl ?? fetch;
  const db = overrides.db ?? openDatabase(config.dbPath);

  const services = createServices(db, {
    clock,
    timezone: config.timezone,
    confirmTtlMinutes: config.confirm.ttlMinutes,
  });

  const stt = overrides.stt ?? createStt(config.stt, { fetchImpl, logger });
  const nlp = overrides.nlp ?? createNlp(config.nlp, { client: overrides.llmClient ?? null, logger });
  const whatsapp = overrides.whatsapp ?? createWhatsAppClient(config.whatsapp, { fetchImpl, logger, clock });
  const pipeline = createPipeline({ config, services, nlp, stt, whatsapp, logger, clock });

  return { config, clock, logger, db, services, stt, nlp, whatsapp, pipeline };
}
