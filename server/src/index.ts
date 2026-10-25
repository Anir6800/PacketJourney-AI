import { SERVER_PORT } from '@packetjourney/shared';
import { createApp } from './app.ts';

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url));
} catch {
  // No .env: AI stays unconfigured, core app is unaffected.
}

const port = Number(process.env.PORT ?? SERVER_PORT);
createApp().listen(port, '127.0.0.1', () => {
  console.log(`PacketJourney AI server on http://127.0.0.1:${port}`);
});
