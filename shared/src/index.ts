import { z } from 'zod';

// Wire contract between web and the optional local AI server.
// ponytail: only /api/health exists in phase 00; tutor schemas arrive with the AI phase.
export const HealthResponse = z.object({
  ok: z.literal(true),
  service: z.literal('packetjourney-ai-server'),
  aiConfigured: z.boolean(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const DEV_ORIGINS = ['http://127.0.0.1:5173', 'http://127.0.0.1:4173'] as const;
export const SERVER_PORT = 8787;

export * from './schemas.ts';
export * from './bytes.ts';
export * from './checksum.ts';
export * from './encode.ts';
export * from './fixtures.ts';
export * from './sim/state.ts';
export * from './sim/topology.ts';
export * from './sim/simulate.ts';
export * from './sim/explain.ts';
export * from './sim/run.ts';
export * from './sim/validate.ts';
export * from './sim/tcp.ts';
export * from './sim/http.ts';
export * from './sim/session.ts';
