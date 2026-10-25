import express from 'express';
import { DEV_ORIGINS, HealthResponse } from '@packetjourney/shared';

const allowed = new Set<string>(DEV_ORIGINS);

export function createApp(env: NodeJS.ProcessEnv = process.env) {
  const app = express();
  app.disable('x-powered-by');

  // Same-origin (Vite proxy) requests carry no Origin header; anything cross-origin must be a known local dev origin.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    if (!allowed.has(origin)) return res.status(403).json({ error: 'origin not allowed' });
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    next();
  });

  app.get('/api/health', (_req, res) => {
    const body: HealthResponse = HealthResponse.parse({
      ok: true,
      service: 'packetjourney-ai-server',
      // Provider, model and base URL are server-only config; never reported or hardcoded.
      aiConfigured: Boolean(env.AI_API_KEY && env.AI_MODEL && env.AI_BASE_URL),
    });
    res.json(body);
  });

  return app;
}
