// Vercel serverless entry point. Vercel calls the default export (an Express app) for every request,
// routed here by the rewrite in vercel.json. Same wiring as src/server.js, but no listen().
// Environment variables come from the Vercel project settings (there is no .env file on Vercel).
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createContainer } from '../src/container.js';

const container = createContainer(loadConfig());

export default createApp(container);
