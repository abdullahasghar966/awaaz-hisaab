import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';

const container = createContainer(loadConfig());
const { config, logger } = container;

// Last line of defence: a background failure must never kill the process silently.
process.on('unhandledRejection', (err) => logger.error('unhandledRejection', { error: err?.message }));

createApp(container).listen(config.port, () => {
  const base = `http://localhost:${config.port}`;
  logger.info(`Awaaz Hisaab listening on ${base}`);
  logger.info(`  webhook:   ${base}/webhook`);
  logger.info(`  dashboard: ${base}/admin/`);
  if (config.devRoutes) logger.info(`  simulator: ${base}/dev/simulator.html`);
  logger.info(`  providers: whatsapp=${container.whatsapp.name} stt=${container.stt.name} nlp=${container.nlp.providerName}`);
});
