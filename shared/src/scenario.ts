import { z } from 'zod';
import { Fault } from './schemas.ts';
import { MODEL_VERSION } from './presets.ts';
import type { CookieChoice } from './sim/session.ts';
import type { SimConfig } from './sim/simulate.ts';
import { validateSimConfig } from './sim/validate.ts';

export const SCENARIO_FORMAT = 'packetjourney-ai/scenario';
export const SCENARIO_VERSION = 1;
export const MAX_SCENARIO_BYTES = 64 * 1024;

const Endpoint = z.object({ ip: z.string(), mac: z.string(), port: z.int() }).strict();
const SimConfigSchema = z.object({
  seed: z.int(),
  template: z.enum(['same-lan', 'routed']),
  protocol: z.enum(['TCP', 'UDP']),
  udpChecksum: z.boolean(),
  request: z.string(),
  endpoints: z.object({ client: Endpoint, server: Endpoint }).strict(),
  requestDstPort: z.int(),
  reply: z.object({ enabled: z.boolean(), text: z.string() }).strict(),
  payloadMode: z.enum(['raw', 'http']),
  http: z.object({ path: z.string(), cookie: z.string().nullable(), knownSessions: z.array(z.string()).max(32) }).strict(),
  close: z.object({ enabled: z.boolean(), timeWaitMs: z.number() }).strict(),
  tcp: z.object({ isnClient: z.number(), isnServer: z.number() }).strict(),
  ttl: z.number(),
  rtoMs: z.number(),
  maxRetries: z.int(),
  maxEvents: z.int(),
  maxDurationMs: z.number(),
  faults: z.array(Fault).max(16),
}).strict();

export const ScenarioFileSchema = z.object({
  format: z.literal(SCENARIO_FORMAT),
  version: z.literal(SCENARIO_VERSION),
  modelVersion: z.literal(MODEL_VERSION),
  name: z.string().min(1).max(80),
  cookieB: z.enum(['valid', 'missing', 'invalid']),
  config: SimConfigSchema,
}).strict();

export type ScenarioFile = {
  format: typeof SCENARIO_FORMAT;
  version: typeof SCENARIO_VERSION;
  modelVersion: typeof MODEL_VERSION;
  name: string;
  cookieB: CookieChoice;
  config: SimConfig;
};

export type ScenarioParse = { ok: true; value: ScenarioFile } | { ok: false; error: string };

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseScenarioJson(text: string): ScenarioParse {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_SCENARIO_BYTES) return { ok: false, error: `Scenario is ${bytes.toLocaleString()} bytes; the safe limit is ${MAX_SCENARIO_BYTES.toLocaleString()} bytes.` };
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' };
  }
  if (!object(input)) return { ok: false, error: 'A scenario must be one JSON object.' };
  if (input['format'] !== SCENARIO_FORMAT) return { ok: false, error: `Not a PacketJourney scenario (${SCENARIO_FORMAT}).` };
  if (typeof input['version'] === 'number' && input['version'] > SCENARIO_VERSION)
    return { ok: false, error: `Scenario version ${input['version']} is newer than supported version ${SCENARIO_VERSION}. Update PacketJourney before importing it.` };
  if (input['version'] !== SCENARIO_VERSION) return { ok: false, error: `Unsupported scenario version ${String(input['version'])}; this build supports version ${SCENARIO_VERSION}.` };
  if (input['modelVersion'] !== MODEL_VERSION)
    return { ok: false, error: `Unsupported model version ${String(input['modelVersion'])}; this build uses model ${MODEL_VERSION}.` };
  const parsed = ScenarioFileSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join('.') : 'file';
    return { ok: false, error: `Invalid ${path}: ${issue?.message ?? 'schema check failed'}.` };
  }
  const issues = validateSimConfig(parsed.data.config);
  if (issues.length) return { ok: false, error: `Invalid config.${issues[0]?.field}: ${issues[0]?.message}` };
  return { ok: true, value: parsed.data };
}

export function createScenarioFile(name: string, config: SimConfig, cookieB: CookieChoice): ScenarioFile {
  const parsed = SimConfigSchema.parse(config);
  const issues = validateSimConfig(parsed);
  if (issues.length) throw new Error(`Cannot export config.${issues[0]?.field}: ${issues[0]?.message}`);
  return { format: SCENARIO_FORMAT, version: SCENARIO_VERSION, modelVersion: MODEL_VERSION, name, cookieB, config: parsed };
}

export const scenarioJson = (name: string, config: SimConfig, cookieB: CookieChoice) => `${JSON.stringify(createScenarioFile(name, config, cookieB), null, 2)}\n`;
