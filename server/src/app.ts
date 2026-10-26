import express from 'express';
import { DEV_ORIGINS, ExplainRequest, HealthResponse, TUTOR_LIMITS, ground, type ExplainResponse } from '@packetjourney/shared';
import { ProviderError, askProvider, type Fetch } from './provider.ts';

const allowed = new Set<string>(DEV_ORIGINS);

export type AppOptions = { fetchImpl?: Fetch; rateLimit?: { max: number; windowMs: number } };

export function createApp(env: NodeJS.ProcessEnv = process.env, opts: AppOptions = {}) {
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

  // ---------- POST /api/explain ----------
  // Bounded body, validated schema, per-client rate limit, upstream timeout. No logging of keys or learner text.
  const limit = opts.rateLimit ?? { max: 10, windowMs: 60_000 };
  const hits = new Map<string, number[]>();
  const STATUS = { timeout: 504, 'rate-limited': 429, upstream: 502, malformed: 502 } as const;
  app.post(
    '/api/explain',
    // Rate limit before parsing, so oversized or malformed requests count too.
    (req, res, next) => {
      const now = Date.now();
      const key = req.ip ?? 'local';
      const recent = (hits.get(key) ?? []).filter((t) => now - t < limit.windowMs);
      if (recent.length >= limit.max) return res.status(429).json({ error: 'rate-limited' });
      hits.set(key, [...recent, now]);
      next();
    },
    express.json({ limit: TUTOR_LIMITS.body }),
    async (req, res) => {
      const parsed = ExplainRequest.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: 'invalid-request' });
      const { AI_BASE_URL, AI_MODEL, AI_API_KEY } = env;
      if (!AI_BASE_URL || !AI_MODEL || !AI_API_KEY) return res.status(503).json({ error: 'ai-not-configured' });
      try {
        const ans = await askProvider({ AI_BASE_URL, AI_MODEL, AI_API_KEY, timeoutMs: Number(env.AI_TIMEOUT_MS ?? 60_000) /* reasoning models can take ~1 min (one live sample: 57 s) */ }, parsed.data, opts.fetchImpl);
        const body: ExplainResponse = { ...ground(parsed.data, ans), source: 'live-ai' };
        return res.json(body);
      } catch (e) {
        const code = e instanceof ProviderError ? e.code : 'upstream';
        return res.status(STATUS[code]).json({ error: code });
      }
    },
  );
  // Oversized or unparsable JSON bodies.
  // Express recognises error handlers by their four parameters, so _next must stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: { type?: string; status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.type === 'entity.too.large' ? 413 : (err.status ?? 400)).json({ error: err.type === 'entity.too.large' ? 'too-large' : 'bad-json' });
  });

  return app;
}
