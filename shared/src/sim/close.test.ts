import { describe, expect, it } from 'vitest';
import { utf8 } from '../bytes.ts';
import { defaultSimConfig, simulate, type SimConfig, type SimRun } from './simulate.ts';
import { TCP_TRANSITIONS, flagNames } from './tcp.ts';
import { CRLF, handleHttp, httpRequest, httpResponse, parseHttp } from './http.ts';
import { INVALID_DEMO_ID, simulateHttpSession } from './session.ts';
import { validateSimConfig } from './validate.ts';

const tcp = (o: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig('same-lan', 'TCP'), close: { enabled: true, timeWaitMs: 400 }, ...o });
const u32 = (b: readonly number[], i: number) => (b[i] ?? 0) * 2 ** 24 + (b[i + 1] ?? 0) * 2 ** 16 + (b[i + 2] ?? 0) * 2 ** 8 + (b[i + 3] ?? 0);
const path = (run: SimRun, dev: string) =>
  run.events.filter((e) => e.device === dev && e.transition?.machine === 'tcp').map((e) => `${e.transition?.from}→${e.transition?.to}`);

function segs(run: SimRun) {
  const out: Record<string, { seq: number; ack: number; flags: string; len: number }> = {};
  for (const e of run.events) {
    if (e.tag !== 'encap:transport' || !e.packetId || !e.bytes) continue;
    const kind = run.timeline.final.packets[e.packetId]?.kind ?? '?';
    if (out[kind]) continue;
    const s = e.bytes;
    out[kind] = { seq: u32(s, 4), ack: u32(s, 8), flags: flagNames(s[13] ?? 0), len: s.length - ((s[12] ?? 0) >> 4) * 4 };
  }
  return out;
}

const OPEN_A = ['CLOSED→SYN-SENT', 'SYN-SENT→ESTABLISHED'];
const OPEN_B = ['CLOSED→LISTEN', 'LISTEN→SYN-RECEIVED', 'SYN-RECEIVED→ESTABLISHED'];
const CLOSE_A = ['ESTABLISHED→FIN-WAIT-1', 'FIN-WAIT-1→FIN-WAIT-2', 'FIN-WAIT-2→TIME-WAIT', 'TIME-WAIT→CLOSED'];
const CLOSE_B = ['ESTABLISHED→CLOSE-WAIT', 'CLOSE-WAIT→LAST-ACK', 'LAST-ACK→CLOSED'];

describe('normal active close after Hello/World', () => {
  const run = simulate(tcp());
  const s = segs(run);

  it('client: FIN-WAIT-1 → FIN-WAIT-2 → TIME-WAIT → CLOSED; server: CLOSE-WAIT → LAST-ACK → CLOSED', () => {
    expect(path(run, 'A')).toEqual([...OPEN_A, ...CLOSE_A]);
    expect(path(run, 'B')).toEqual([...OPEN_B, ...CLOSE_B]);
    for (const e of run.events.filter((x) => x.transition?.machine === 'tcp'))
      expect(TCP_TRANSITIONS.some((t) => t.from === e.transition?.from && t.to === e.transition?.to)).toBe(true);
  });

  it('each FIN consumes exactly one sequence number', () => {
    // After Hello (1001..1005) and World (5001..5005).
    expect(s['fin-client']).toEqual({ seq: 1006, ack: 5006, flags: 'ACK, FIN', len: 0 });
    expect(s['ack-fin-client']).toEqual({ seq: 5006, ack: 1007, flags: 'ACK', len: 0 });
    expect(s['fin-server']).toEqual({ seq: 5006, ack: 1007, flags: 'ACK, FIN', len: 0 });
    expect(s['ack-fin-server']).toEqual({ seq: 1007, ack: 5007, flags: 'ACK', len: 0 });
    const f = run.timeline.final.endpoints;
    expect([f.A?.sndNxt, f.A?.rcvNxt, f.B?.sndNxt, f.B?.rcvNxt]).toEqual([1007, 5007, 5007, 1007]);
  });

  it('final ACK then the educational TIME-WAIT timer closes the client', () => {
    const fire = run.events.find((e) => e.tag === 'timer:fire:time-wait');
    const set = run.events.find((e) => e.tag === 'timer:set:time-wait');
    expect(set?.explainArgs.ms).toBe(400);
    expect((fire?.virtualTimeMs ?? 0) - (set?.virtualTimeMs ?? 0)).toBeCloseTo(400, 9);
    // Server closes on the final ACK, before the client's timer expires.
    const serverClosed = run.events.find((e) => e.device === 'B' && e.tag === 'tcp:state:CLOSED');
    expect(serverClosed?.index).toBeLessThan(fire?.index ?? 0);
    expect(run.timeline.final.end?.reason).toBe('complete');
  });

  it('the client closes only after it processed the reply', () => {
    const processed = run.events.find((e) => e.device === 'A' && e.tag === 'app:processed');
    const close = run.events.find((e) => e.tag === 'app:close' && e.device === 'A');
    expect(close?.index).toBeGreaterThan(processed?.index ?? Infinity);
  });

  it('close disabled keeps the old ESTABLISHED ending', () => {
    const r = simulate(tcp({ close: { enabled: false, timeWaitMs: 400 } }));
    expect(r.timeline.final.endpoints.A?.tcpState).toBe('ESTABLISHED');
    expect(r.events.some((e) => e.tag.includes('FIN') || e.tag === 'app:close')).toBe(false);
  });

  it('works over the routed fixture too', () => {
    const r = simulate({ ...tcp(), ...defaultSimConfig('routed', 'TCP'), close: { enabled: true, timeWaitMs: 400 } });
    expect(r.template.path).toHaveLength(4);
    expect(path(r, 'A')).toEqual([...OPEN_A, ...CLOSE_A]);
    expect(path(r, 'B')).toEqual([...OPEN_B, ...CLOSE_B]);
  });
});

describe('orderly no-data close', () => {
  const run = simulate(tcp({ request: '' }));
  it('handshake then close, no data segments, no skipped states', () => {
    expect(path(run, 'A')).toEqual([...OPEN_A, ...CLOSE_A]);
    expect(path(run, 'B')).toEqual([...OPEN_B, ...CLOSE_B]);
    const s = segs(run);
    expect(s.data).toBeUndefined();
    expect(s['fin-client']).toMatchObject({ seq: 1001, ack: 5001 });
    expect(s['fin-server']).toMatchObject({ seq: 5001, ack: 1002 });
    expect(s['ack-fin-server']).toMatchObject({ seq: 1002, ack: 5002 });
  });
  it('empty message is only valid as a TCP no-data close', () => {
    expect(validateSimConfig(tcp({ request: '' }))).toEqual([]);
    expect(validateSimConfig(tcp({ request: '', close: { enabled: false, timeWaitMs: 400 } })).map((i) => i.field)).toContain('request');
    expect(validateSimConfig({ ...defaultSimConfig(), request: '' }).map((i) => i.field)).toContain('request');
  });
});

describe('close recovery paths', () => {
  it('lost final ACK: server retransmits FIN, client re-ACKs and restarts TIME-WAIT', () => {
    const run = simulate(tcp({ faults: [{ kind: 'loss', packet: 'ack-fin-server', count: 1 }] }));
    expect(run.events.filter((e) => e.tag === 'tcp:retransmit' && e.device === 'B')).toHaveLength(1);
    expect(run.events.some((e) => e.tag === 'tcp:duplicate-fin' && e.device === 'A')).toBe(true);
    expect(run.events.filter((e) => e.tag === 'timer:set:time-wait')).toHaveLength(2);
    expect(run.events.filter((e) => e.tag === 'timer:fire:time-wait')).toHaveLength(1); // the first generation is stale
    expect(path(run, 'A')).toEqual([...OPEN_A, ...CLOSE_A]);
    expect(path(run, 'B')).toEqual([...OPEN_B, ...CLOSE_B]);
  });
  it('lost client FIN is retransmitted by RTO', () => {
    const run = simulate(tcp({ faults: [{ kind: 'loss', packet: 'fin-client', count: 1 }] }));
    expect(run.events.filter((e) => e.tag === 'tcp:retransmit' && e.device === 'A')).toHaveLength(1);
    expect(path(run, 'A')).toEqual([...OPEN_A, ...CLOSE_A]);
  });
  it('lost ACK of the client FIN: server FIN+ACK moves FIN-WAIT-1 → FIN-WAIT-2 → TIME-WAIT', () => {
    const run = simulate(tcp({ faults: [{ kind: 'loss', packet: 'ack-fin-client', count: 1 }] }));
    expect(path(run, 'A')).toEqual([...OPEN_A, ...CLOSE_A]);
    expect(path(run, 'B')).toEqual([...OPEN_B, ...CLOSE_B]);
  });
  it('TIME-WAIT must be 1–2000 ms', () => {
    expect(validateSimConfig(tcp({ close: { enabled: true, timeWaitMs: 0 } })).map((i) => i.field)).toContain('close.timeWaitMs');
  });
});

describe('HTTP messages', () => {
  it('request uses CRLF separators and ends with an empty line', () => {
    const r = httpRequest({ path: '/', host: '192.168.1.20', cookie: 'demo-1' });
    expect(r).toBe('GET / HTTP/1.1\r\nHost: 192.168.1.20\r\nCookie: sid=demo-1\r\n\r\n');
  });
  it('Content-Length counts UTF-8 bytes of the body, not characters', () => {
    const body = 'Hello — new session'; // em dash = 3 bytes
    const res = httpResponse(body, null);
    const p = parseHttp(res);
    expect(Number(p?.headers['content-length'])).toBe(utf8(body).length);
    expect(utf8(body).length).toBe([...body].length + 2);
    expect(p?.body).toBe(body);
    expect(res.split(CRLF + CRLF)).toHaveLength(2);
  });
  it('session table: missing → issue, known → recognized, unknown → unrecognized', () => {
    const first = handleHttp(httpRequest({ path: '/', host: 'h', cookie: null }), [], 1);
    expect(first.verdict).toBe('unrecognized');
    expect(first.issued).toMatch(/^demo-[0-9a-f]{8}$/);
    expect(parseHttp(first.response)?.headers['set-cookie']).toContain(`sid=${first.issued}`);
    const again = handleHttp(httpRequest({ path: '/', host: 'h', cookie: first.issued }), first.known, 1);
    expect(again.verdict).toBe('recognized');
    expect(parseHttp(again.response)?.headers['set-cookie']).toBeUndefined();
    expect(handleHttp(httpRequest({ path: '/', host: 'h', cookie: 'demo-bad' }), first.known, 1).verdict).toBe('unrecognized');
  });
});

describe('HTTP session across two TCP connections', () => {
  const ses = simulateHttpSession(defaultSimConfig('same-lan', 'TCP'), 'valid');
  const server = (r: SimRun) => r.timeline.final.endpoints[r.template.server];

  it('connection A issues a demo id and closes fully', () => {
    expect(ses.issued).toMatch(/^demo-/);
    expect(server(ses.a)?.session?.verdict).toBe('unrecognized');
    expect(path(ses.a, 'A')).toEqual([...OPEN_A, ...CLOSE_A]);
    expect(ses.a.timeline.final.endpoints.A?.session?.known).toEqual([ses.issued]);
  });

  it('connection B uses another client port and is recognized by the cookie', () => {
    expect(ses.b.config.endpoints.client.port).not.toBe(ses.a.config.endpoints.client.port);
    expect(ses.b.config.endpoints.server.port).toBe(ses.a.config.endpoints.server.port);
    expect(path(ses.b, 'A')).toEqual([...OPEN_A, ...CLOSE_A]); // a fresh handshake: not a continuation of A
    expect(server(ses.b)?.session?.verdict).toBe('recognized');
    expect(server(ses.b)?.session?.cookieSent).toBe(ses.issued);
  });

  it('missing or invalid cookie → unrecognized on B', () => {
    for (const c of ['missing', 'invalid'] as const) {
      const r = simulateHttpSession(defaultSimConfig('same-lan', 'TCP'), c);
      expect(server(r.b)?.session?.verdict, c).toBe('unrecognized');
      expect(server(r.b)?.session?.cookieSent).toBe(c === 'missing' ? null : INVALID_DEMO_ID);
    }
  });

  it('sequence numbers cover every actual HTTP byte (never the raw Hello numbers)', () => {
    for (const r of [ses.a, ses.b]) {
      const s = segs(r);
      const req = httpRequest({ path: r.config.http.path, host: r.config.endpoints.server.ip, cookie: r.config.http.cookie });
      const reqLen = utf8(req).length;
      const isn = r.config.tcp.isnClient;
      expect(s.data?.len).toBe(reqLen);
      expect(s.data?.seq).toBe(isn + 1);
      expect(s.ack?.ack).toBe(isn + 1 + reqLen);
      expect(reqLen).not.toBe(5);
      const delivered = r.events.find((e) => e.tag === 'deliver:app' && e.device === 'A');
      const resLen = delivered?.bytes?.length ?? 0;
      expect(s['fin-client']?.seq).toBe(isn + 1 + reqLen);
      expect(s['fin-client']?.ack).toBe(r.config.tcp.isnServer + 1 + resLen);
      const text = new TextDecoder().decode(Uint8Array.from(delivered?.bytes ?? []));
      const p = parseHttp(text);
      expect(Number(p?.headers['content-length'])).toBe(utf8(p?.body ?? '').length);
    }
  });

  it('UDP cannot enter HTTP session mode', () => {
    const issues = validateSimConfig({ ...defaultSimConfig('same-lan', 'UDP'), payloadMode: 'http' });
    expect(issues.map((i) => i.field)).toContain('payloadMode');
    expect(() => simulate({ ...defaultSimConfig('same-lan', 'UDP'), payloadMode: 'http' })).toThrow(/HTTP\/session mode needs TCP/);
  });

  it('deterministic', () => {
    const again = simulateHttpSession(defaultSimConfig('same-lan', 'TCP'), 'valid');
    expect(again.b.events).toEqual(ses.b.events);
  });
});
