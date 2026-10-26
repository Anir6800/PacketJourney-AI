import { simulate, type SimConfig, type SimRun } from './simulate.ts';

// HTTP session demo: two separate TCP connections. The application session (a demo cookie in the
// server app's in-memory table) outlives connection A; connection B is a new four-tuple. No session-layer header exists.

export type CookieChoice = 'valid' | 'missing' | 'invalid';

export type HttpSessionRun = {
  a: SimRun;
  b: SimRun;
  /** Demo id issued on connection A (null if A never got that far). */
  issued: string | null;
  cookieB: CookieChoice;
};

/** A deliberately wrong id with the same shape, so "invalid" differs only in value. */
export const INVALID_DEMO_ID = 'demo-00000000';

export function httpSessionConfigs(base: SimConfig): { a: SimConfig; b: (cookie: string | null, known: string[]) => SimConfig } {
  const common: SimConfig = { ...structuredClone(base), protocol: 'TCP', payloadMode: 'http', close: { ...base.close, enabled: true } };
  const a: SimConfig = { ...common, http: { path: '/', cookie: null, knownSessions: [] } };
  const b = (cookie: string | null, known: string[]): SimConfig => ({
    ...common,
    seed: base.seed + 1,
    // New connection: another ephemeral client port, new teaching ISNs. Same server port and addresses.
    endpoints: { ...common.endpoints, client: { ...common.endpoints.client, port: nextPort(common.endpoints.client.port) } },
    tcp: { isnClient: common.tcp.isnClient + 1000, isnServer: common.tcp.isnServer + 1000 },
    http: { path: '/profile', cookie, knownSessions: known },
  });
  return { a, b };
}

const nextPort = (p: number) => (p >= 65535 ? 49152 : p + 1);

export function simulateHttpSession(base: SimConfig, cookieB: CookieChoice): HttpSessionRun {
  return continueHttpSession(simulate(httpSessionConfigs(base).a), base, cookieB);
}

/** Connection B, given an already simulated connection A (whose config came from `httpSessionConfigs(base).a`). */
export function continueHttpSession(a: SimRun, base: SimConfig, cookieB: CookieChoice): HttpSessionRun {
  const cfg = httpSessionConfigs(base);
  const server = a.timeline.final.endpoints[a.template.server]?.session;
  const issued = server?.issued ?? null;
  const cookie = cookieB === 'missing' ? null : cookieB === 'invalid' ? INVALID_DEMO_ID : issued;
  const b = simulate(cfg.b(cookie, server?.known ?? []));
  return { a, b, issued, cookieB };
}
