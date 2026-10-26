import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultSimConfig, simulate, type SimConfig } from '@packetjourney/shared';
import { T, buildStory, estimateSeconds, fill, type Beat, type TemplateKey } from './script.ts';
import { INITIAL_STORY, questionsFor, validate, withFault } from './questions.ts';

const cfg = (t: 'same-lan' | 'routed', p: 'TCP' | 'UDP', o: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig(t, p), ...o });
const story = (c: SimConfig) => {
  const run = simulate(c);
  return { run, beats: buildStory(run) };
};
const u16 = (b: readonly number[], i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32 = (b: readonly number[], i: number) => (b[i] ?? 0) * 2 ** 24 + (b[i + 1] ?? 0) * 2 ** 16 + (b[i + 2] ?? 0) * 2 ** 8 + (b[i + 3] ?? 0);
const hex4 = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
const layersOf = (beats: Beat[], ch: Beat['chapter']) => beats.filter((b) => b.chapter === ch && b.kind === 'layer').map((b) => b.layer);

const FIXTURES = [cfg('same-lan', 'UDP'), cfg('routed', 'UDP'), cfg('same-lan', 'TCP'), cfg('routed', 'TCP'), cfg('routed', 'TCP', { payloadMode: 'http' })];

describe('story script', () => {
  it('templates hold no hand-written numbers (only placeholders) and all are documented', () => {
    const doc = readFileSync(new URL('../../../docs/STORY_SCRIPT.md', import.meta.url), 'utf8');
    for (const [k, t] of Object.entries(T)) {
      const prose = t.replace(/\{\w+\}/g, '').replace(/IPv4|UTF-8|0x/g, '');
      expect(prose, k).not.toMatch(/\d/);
      expect(doc, `docs/STORY_SCRIPT.md lists ${k}`).toContain(`\`${k}\``);
    }
  });

  it('every caption is exactly its template filled with its values', () => {
    for (const c of FIXTURES) {
      for (const b of story(c).beats) {
        const [title, ...lines] = b.keys as [TemplateKey, ...TemplateKey[]];
        expect(b.title).toBe(fill(title, b.values));
        expect(b.lines).toEqual(lines.map((k) => fill(k, b.values)));
      }
    }
  });

  it('encapsulation is Application → Transport → Internet → Link → Physical; decapsulation is the reverse (outermost first)', () => {
    for (const c of FIXTURES) {
      const { beats } = story(c);
      expect(layersOf(beats, 'encap')).toEqual(['app', 'transport', 'internet', 'link', 'physical']);
      expect(layersOf(beats, 'decap')).toEqual(['link', 'internet', 'transport', 'app']);
      const ch = beats.map((b) => b.chapter);
      expect(ch.indexOf('journey')).toBeGreaterThan(ch.lastIndexOf('encap'));
      expect(ch.indexOf('decap')).toBeGreaterThan(ch.lastIndexOf('journey'));
      expect(ch.indexOf('recap')).toBeGreaterThan(ch.lastIndexOf('decap'));
    }
  });

  it('TCP and UDP stories differ: UDP has no handshake, state or ACK beats', () => {
    const udp = story(cfg('routed', 'UDP')).beats.filter((b) => b.chapter === 'journey');
    const tcp = story(cfg('routed', 'TCP')).beats.filter((b) => b.chapter === 'journey');
    expect(udp.some((b) => ['state', 'ack', 'ack-send'].includes(b.kind))).toBe(false);
    expect(tcp.filter((b) => b.kind === 'state').map((b) => b.values.to)).toEqual(expect.arrayContaining(['SYN-SENT', 'SYN-RECEIVED', 'ESTABLISHED']));
    expect(tcp.some((b) => b.kind === 'ack')).toBe(true);
    // Handshake before the request is sent.
    const est = tcp.findIndex((b) => b.kind === 'state' && b.values.to === 'ESTABLISHED');
    const req = tcp.findIndex((b) => b.kind === 'send' && b.values.label === 'the request');
    expect(est).toBeGreaterThanOrEqual(0);
    expect(req).toBeGreaterThan(est);
  });

  it('every number in the routed TCP story equals the engine output (re-derived from frame bytes)', () => {
    const { run, beats } = story(cfg('routed', 'TCP'));
    const kind = (pid: string | null) => run.timeline.final.packets[pid ?? '']?.kind;
    const dataLink = run.events.find((e) => e.tag === 'encap:link' && e.device === 'A' && kind(e.packetId) === 'data');
    const fr = dataLink?.bytes ?? [];
    const tcpAt = 34;
    const get = (id: string) => beats.find((b) => b.id.startsWith(id));
    const t = get('encap:layer:' + run.events.find((e) => e.tag === 'encap:transport' && kind(e.packetId) === 'data')?.index);
    expect(t?.values).toMatchObject({ src: u16(fr, tcpAt), dst: u16(fr, tcpAt + 2), seq: u32(fr, tcpAt + 4), ack: u32(fr, tcpAt + 8), cs: hex4(u16(fr, tcpAt + 16)), hdr: 20, bytes: 5 });
    const i = beats.find((b) => b.chapter === 'encap' && b.layer === 'internet');
    expect(i?.values).toMatchObject({ ttl: fr[22], srcIp: fr.slice(26, 30).join('.'), dstIp: fr.slice(30, 34).join('.'), cs: hex4(u16(fr, 24)), total: u16(fr, 16), hdr: 20 });
    const l = beats.find((b) => b.chapter === 'encap' && b.layer === 'link');
    const mac = (o: number) => fr.slice(o, o + 6).map((x) => x.toString(16).padStart(2, '0')).join(':');
    expect(l?.values).toMatchObject({ dstMac: mac(0), srcMac: mac(6), etherType: '0800', frame: fr.length });
    expect(l?.values.fcs).toBe(fr.slice(-4).reverse().map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(''));
    // Router hops: TTL from the frames each router actually transmitted.
    const hops = beats.filter((b) => b.kind === 'hop');
    expect(hops.map((h) => h.values.device)).toEqual(['R1', 'R2']);
    expect(hops.map((h) => [h.values.ttlFrom, h.values.ttlTo])).toEqual([[64, 63], [63, 62]]);
    const egress = run.events.filter((e) => e.type === 'transmit' && kind(e.packetId) === 'data');
    expect(beats.find((b) => b.kind === 'changes')?.values.ttls).toBe(egress.map((e) => e.bytes?.[22]).join(' → '));
    // Delivery at B: the bytes delivered are the bytes sent.
    const d = beats.find((b) => b.chapter === 'decap' && b.layer === 'app');
    expect(d?.values).toMatchObject({ device: 'B', bytes: 5, text: 'Hello' });
    // Sequence numbers in the journey: SYN 1000, SYN-ACK 5000/1001, request 1001/5001.
    const sends = beats.filter((b) => b.chapter === 'journey' && (b.kind === 'send' || b.kind === 'ack-send')).map((b) => [b.values.label, b.values.seq, b.values.ack]);
    expect(sends.slice(0, 4)).toEqual([['SYN', 1000, 0], ['SYN-ACK', 5000, 1001], ['the handshake ACK', 1001, 5001], ['the request', 1001, 5001]]);
  });

  it('a fault story shows the loss and the retransmission (TCP) or the missing delivery (UDP)', () => {
    const t = story(withFault(cfg('routed', 'TCP'), 'lose-data')).beats;
    expect(t.some((b) => b.kind === 'drop')).toBe(true);
    expect(t.some((b) => b.kind === 'retx')).toBe(true);
    const u = story(withFault(cfg('routed', 'UDP'), 'lose-data')).beats;
    expect(u.some((b) => b.kind === 'drop')).toBe(true);
    expect(u.find((b) => b.chapter === 'decap')?.kind).toBe('missing');
  });

  it('predictions come from re-running the engine', () => {
    const r = story(cfg('routed', 'TCP')).beats.find((b) => b.kind === 'predict')?.predict ?? [];
    expect(r[0]?.a).toContain('At R1');
    expect(r[1]?.a).toBe('ACK 1007: it acknowledges every byte, so it grows by one.');
    const s = story(cfg('same-lan', 'UDP')).beats.find((b) => b.kind === 'predict')?.predict ?? [];
    expect(s[0]?.a).toContain('still arrives at B');
    expect(s[1]?.a).toMatch(/^0:/);
  });

  it('routed TCP story fits 2–4 minutes at 1×', () => {
    const sec = estimateSeconds(story(cfg('routed', 'TCP')).beats);
    expect(sec).toBeGreaterThan(120);
    expect(sec).toBeLessThan(240);
  });
});

describe('story questions', () => {
  it('HTTP question only for TCP; invalid answers are blocked', () => {
    expect(questionsFor(cfg('same-lan', 'TCP'))).toContain('payload');
    expect(questionsFor(cfg('same-lan', 'UDP'))).not.toContain('payload');
    expect(validate('message', cfg('same-lan', 'UDP', { request: '' }))[0]?.field).toBe('request');
    expect(validate('message', cfg('same-lan', 'UDP', { request: 'x'.repeat(300) }))[0]?.message).toMatch(/300 bytes/);
    const bad = cfg('same-lan', 'UDP');
    expect(validate('ports', { ...bad, endpoints: { ...bad.endpoints, client: { ...bad.endpoints.client, port: 0 } } })[0]?.field).toBe('client.port');
    expect(validate('ports', { ...bad, endpoints: { ...bad.endpoints, server: { ...bad.endpoints.server, port: bad.endpoints.client.port } } })[0]?.field).toBe('server.port');
    expect(validate('ports', bad)).toEqual([]);
    expect(INITIAL_STORY.phase).toBe('ask');
  });
});
