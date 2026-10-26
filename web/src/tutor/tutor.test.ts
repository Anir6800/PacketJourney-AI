import { describe, expect, it } from 'vitest';
import { defaultSimConfig, simulate, type ExplainResponse } from '@packetjourney/shared';
import { TutorClient, buildRequest, builtIn } from './tutor.ts';

const run = simulate(defaultSimConfig('routed', 'TCP'));
const fwd = run.events.findIndex((e) => e.tag === 'hop:R1:forward');
const ttl = run.timeline.final.fields.find((f) => f.id === 'ipv4.ttl') ?? null;

describe('tutor (built-in, no key)', () => {
  it('builds a bounded snapshot request from the current step', () => {
    const r = buildRequest({ kind: 'field', run, step: fwd, layer: 'internet', field: ttl, question: '  why?  ' });
    expect(r.question).toBe('why?');
    expect(r.context.field?.id).toBe('ipv4.ttl');
    expect(r.context.fields.every((f) => f.id.startsWith('ipv4.'))).toBe(true);
    expect(r.context.event?.tag).toBe('hop:R1:forward');
    expect(r.context.state).toMatchObject({ A: 'SYN-SENT · app sent' }); // the first R1 forward is the SYN
  });

  it('built-in answers for layer, field, why and compare are labelled built-in and reference supplied ids', () => {
    const field = builtIn(buildRequest({ kind: 'field', run, step: fwd, layer: 'internet', field: ttl, question: '' }), run);
    expect(field).toMatchObject({ source: 'built-in', grounding: 'verified', refs: ['ipv4.ttl'] });
    expect(field.explanation).toContain('TTL = 64');
    const why = builtIn(buildRequest({ kind: 'why', run, step: fwd, layer: null, field: null, question: '' }), run);
    expect(why.refs[0]).toBe(run.events[fwd]?.id);
    expect(why.explanation).toMatch(/Because of route:lookup at R1/);
    expect(builtIn(buildRequest({ kind: 'layer', run, step: fwd, layer: 'link', field: null, question: '' }), run).explanation).toMatch(/new frame/);
    expect(builtIn(buildRequest({ kind: 'compare', run, step: fwd, layer: null, field: null, question: '' }), run).explanation).toMatch(/three-way handshake/);
  });
});

describe('TutorClient (live, mocked fetch)', () => {
  const ok = (explanation: string): Response => new Response(JSON.stringify({ explanation, refs: ['ipv4.ttl'], caveats: [], source: 'live-ai', grounding: 'verified' }), { status: 200 });
  const req = buildRequest({ kind: 'field', run, step: fwd, layer: 'internet', field: ttl, question: '' });

  it('stale-response race: a slow older answer never overwrites the newer one', async () => {
    let releaseFirst: (r: Response) => void = () => undefined;
    const calls: string[] = [];
    const client = new TutorClient((_u, init) => {
      const n = calls.push(String(init?.body));
      // Ignore abort for the first call so it resolves late, after the second.
      return n === 1 ? new Promise<Response>((r) => (releaseFirst = r)) : Promise.resolve(ok('second'));
    });
    const applied: string[] = [];
    const first = client.ask(req, (r) => applied.push(r.res?.explanation ?? `err:${r.err?.code}`));
    const second = client.ask(req, (r) => applied.push(r.res?.explanation ?? `err:${r.err?.code}`));
    await second;
    releaseFirst(ok('first (stale)'));
    await first;
    expect(applied).toEqual(['second']);
  });

  it('errors keep a status (timeout 504, 429, network) and are not mistaken for answers', async () => {
    const out: (ExplainResponse | string)[] = [];
    for (const res of [new Response('{"error":"timeout"}', { status: 504 }), new Response('{"error":"rate-limited"}', { status: 429 })]) {
      await new TutorClient(async () => res).ask(req, (r) => out.push(r.res ?? `${r.err?.status}:${r.err?.code}`));
    }
    await new TutorClient(async () => Promise.reject(new TypeError('down'))).ask(req, (r) => out.push(r.res ?? `${r.err?.status}:${r.err?.code}`));
    expect(out).toEqual(['504:timeout', '429:rate-limited', '0:network']);
  });

  it('only the fixed path is ever requested', async () => {
    const urls: string[] = [];
    await new TutorClient(async (u) => (urls.push(String(u)), ok('x'))).ask(req, () => undefined);
    expect(urls).toEqual(['/api/explain']);
  });
});
