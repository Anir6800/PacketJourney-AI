import { describe, expect, it } from 'vitest';
import { CRC32_RESIDUE, crc32, pseudoHeader, verifyInternetChecksum } from '../checksum.ts';
import { packetFromFrame } from '../encode.ts';
import { defaultSimConfig, simulate, type SimConfig, type SimRun } from './simulate.ts';
import { RunController } from './run.ts';
import { TCP_TRANSITIONS, flagNames } from './tcp.ts';

const tcp = (o: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig('same-lan', 'TCP'), ...o });
const u32 = (b: readonly number[], i: number) => (b[i] ?? 0) * 2 ** 24 + (b[i + 1] ?? 0) * 2 ** 16 + (b[i + 2] ?? 0) * 2 ** 8 + (b[i + 3] ?? 0);

/** First transmission of each packet kind, decoded from the actual segment bytes. */
function segments(run: SimRun) {
  const out: Record<string, { seq: number; ack: number; flags: string; len: number; from: string }> = {};
  for (const e of run.events) {
    if (e.tag !== 'encap:transport' || !e.packetId || !e.bytes) continue;
    const kind = run.timeline.final.packets[e.packetId]?.kind ?? '?';
    if (out[kind]) continue;
    const s = e.bytes;
    out[kind] = { seq: u32(s, 4), ack: u32(s, 8), flags: flagNames(s[13] ?? 0), len: s.length - ((s[12] ?? 0) >> 4) * 4, from: e.device };
  }
  return out;
}

describe('TCP handshake + one data segment per direction (teaching ISNs 1000/5000)', () => {
  const run = simulate(tcp());
  const s = segments(run);

  it('exact sequence / ACK values for raw Hello and World', () => {
    expect(s.syn).toEqual({ seq: 1000, ack: 0, flags: 'SYN', len: 0, from: 'A' });
    expect(s['syn-ack']).toEqual({ seq: 5000, ack: 1001, flags: 'SYN, ACK', len: 0, from: 'B' });
    expect(s['hs-ack']).toEqual({ seq: 1001, ack: 5001, flags: 'ACK', len: 0, from: 'A' });
    expect(s.data).toEqual({ seq: 1001, ack: 5001, flags: 'ACK, PSH', len: 5, from: 'A' });
    expect(s.ack).toEqual({ seq: 5001, ack: 1006, flags: 'ACK', len: 0, from: 'B' });
    expect(s.response).toEqual({ seq: 5001, ack: 1006, flags: 'ACK, PSH', len: 5, from: 'B' });
    expect(s['response-ack']).toEqual({ seq: 1006, ack: 5006, flags: 'ACK', len: 0, from: 'A' });
  });

  it('state machines follow the shared transition table', () => {
    const path = (dev: string) =>
      run.events.filter((e) => e.device === dev && e.transition?.machine === 'tcp').map((e) => `${e.transition?.from}→${e.transition?.to}`);
    expect(path('A')).toEqual(['CLOSED→SYN-SENT', 'SYN-SENT→ESTABLISHED']);
    expect(path('B')).toEqual(['CLOSED→LISTEN', 'LISTEN→SYN-RECEIVED', 'SYN-RECEIVED→ESTABLISHED']);
    for (const e of run.events.filter((x) => x.transition?.machine === 'tcp'))
      expect(TCP_TRANSITIONS.some((t) => t.from === e.transition?.from && t.to === e.transition?.to)).toBe(true);
    const f = run.timeline.final.endpoints;
    expect([f.A?.tcpState, f.B?.tcpState]).toEqual(['ESTABLISHED', 'ESTABLISHED']);
    expect([f.A?.iss, f.A?.irs, f.B?.iss, f.B?.irs]).toEqual([1000, 5000, 5000, 1000]);
    expect([f.A?.sndNxt, f.A?.rcvNxt, f.B?.sndNxt, f.B?.rcvNxt]).toEqual([1006, 5006, 5006, 1006]);
  });

  it('no delivery before ESTABLISHED; client data only after it is ESTABLISHED', () => {
    for (const e of run.events.filter((x) => x.tag === 'deliver:app'))
      expect(run.timeline.at(e.index - 1).endpoints[e.device]?.tcpState).toBe('ESTABLISHED');
    const established = run.events.find((e) => e.device === 'A' && e.tag === 'tcp:state:ESTABLISHED')?.index ?? Infinity;
    const dataEncap = run.events.find((e) => e.tag === 'encap:transport' && run.timeline.final.packets[e.packetId ?? '']?.kind === 'data')?.index ?? -1;
    expect(dataEncap).toBeGreaterThan(established);
    // The app wrote before the connection existed: it was queued, not sent.
    expect(run.events.find((e) => e.tag === 'app:send')?.explainKey).toBe('app.send.queued');
  });

  it('pure ACKs never advance the sequence number; SYN consumes one', () => {
    for (const e of run.events.filter((x) => x.tag === 'encap:transport')) {
      const before = run.timeline.at(e.index - 1).endpoints[e.device]?.sndNxt ?? 0;
      const after = run.timeline.at(e.index).endpoints[e.device]?.sndNxt ?? 0;
      const kind = run.timeline.final.packets[e.packetId ?? '']?.kind;
      const expected = { syn: 1, 'syn-ack': 1, data: 5, response: 5, 'hs-ack': 0, ack: 0, 'response-ack': 0 }[kind ?? 'ack'];
      expect((after - before + 2 ** 32) % 2 ** 32, `${kind}`).toBe(expected);
      expect(e.explainArgs.consumes).toBe(expected);
    }
  });

  it('transport ACK and application processing are separate events', () => {
    const t = (pred: (tag: string, dev: string) => boolean) => run.events.find((e) => pred(e.tag, e.device));
    const deliver = t((tag, d) => tag === 'deliver:app' && d === 'B');
    const ackEncap = run.events.find((e) => e.tag === 'encap:transport' && run.timeline.final.packets[e.packetId ?? '']?.kind === 'ack');
    const processed = t((tag, d) => tag === 'app:processed' && d === 'B');
    const respond = t((tag) => tag === 'app:respond');
    expect(ackEncap?.virtualTimeMs).toBe(deliver?.virtualTimeMs); // no delayed ACK
    expect((processed?.virtualTimeMs ?? 0) - (deliver?.virtualTimeMs ?? 0)).toBeCloseTo(1, 9); // 1 ms app delay
    expect(ackEncap?.index).toBeLessThan(processed?.index ?? 0);
    expect(respond?.index).toBeGreaterThan(processed?.index ?? 0);
  });

  it('every TCP packet, control or data, is a valid IPv4 / Ethernet frame', () => {
    const tx = run.events.filter((e) => e.type === 'transmit');
    expect(tx.length).toBe(7);
    for (const e of tx) {
      const frame = Uint8Array.from(e.bytes ?? []);
      expect(crc32(frame)).toBe(CRC32_RESIDUE);
      const ip = packetFromFrame(frame);
      expect(verifyInternetChecksum(ip.slice(0, 20))).toBe(true);
      expect(ip[9]).toBe(6);
      const seg = ip.slice(20);
      expect(verifyInternetChecksum(pseudoHeader(ip.slice(12, 16), ip.slice(16, 20), 6, seg.length), seg)).toBe(true);
      expect(frame.length).toBeGreaterThanOrEqual(64);
    }
  });

  it('header field map and log agree on the first data segment', () => {
    const f = run.timeline.final.fields;
    expect(f.find((x) => x.id === 'tcp.seqNumber')?.raw).toBe(1001);
    expect(f.find((x) => x.id === 'tcp.ackNumber')?.raw).toBe(5001);
    const enc = run.events.find((e) => e.tag === 'encap:transport' && e.explainArgs.consumes === 5);
    expect(enc?.explainArgs['Sequence number']).toBe('1001 (0x000003E9)');
  });
});

describe('TCP byte counting and edge cases', () => {
  it('Unicode payloads count UTF-8 bytes, not characters', () => {
    const s = segments(simulate(tcp({ request: 'héllo ✓', reply: { enabled: true, text: 'Wörld' } })));
    expect(s.data?.len).toBe(10); // é 2 B, ✓ 3 B
    expect(s.ack?.ack).toBe(1011);
    expect(s.response?.len).toBe(6);
    expect(s['response-ack']?.ack).toBe(5007);
  });

  it('sequence numbers wrap modulo 2^32', () => {
    const s = segments(simulate(tcp({ tcp: { isnClient: 4294967295, isnServer: 4294967294 } })));
    expect(s.syn?.seq).toBe(4294967295);
    expect(s['syn-ack']?.ack).toBe(0);
    expect(s.data?.seq).toBe(0);
    expect(s.ack?.ack).toBe(5);
    expect(s.response?.seq).toBe(4294967295);
    expect(s['response-ack']?.ack).toBe(4);
  });

  it('configurable ISNs; invalid ISNs are rejected', () => {
    const s = segments(simulate(tcp({ tcp: { isnClient: 1, isnServer: 2 } })));
    expect([s.syn?.seq, s['syn-ack']?.seq, s['syn-ack']?.ack]).toEqual([1, 2, 2]);
    expect(() => simulate(tcp({ tcp: { isnClient: -1, isnServer: 5000 } }))).toThrow(/ISN/);
    expect(() => simulate(tcp({ tcp: { isnClient: 2 ** 32, isnServer: 5000 } }))).toThrow(/ISN/);
  });

  it('lost SYN is retransmitted; the connection still opens', () => {
    const run = simulate(tcp({ faults: [{ kind: 'loss', packet: 'syn', count: 1 }] }));
    const tags = run.events.map((e) => e.tag);
    expect(tags).toContain('tcp:retransmit');
    expect(run.timeline.final.endpoints.B?.recvBuffer.length).toBe(5);
  });

  it('lost handshake ACK: server becomes ESTABLISHED on the data segment’s ACK', () => {
    const run = simulate(tcp({ faults: [{ kind: 'loss', packet: 'hs-ack', count: 1 }] }));
    const est = run.events.find((e) => e.device === 'B' && e.tag === 'tcp:state:ESTABLISHED');
    expect(run.events[(est?.index ?? 0) + 1]?.tag).toBe('deliver:app');
    expect(new TextDecoder().decode(Uint8Array.from(run.timeline.final.endpoints.B?.recvBuffer ?? []))).toBe('Hello');
  });

  it('wrong port: SYN reaches no listener, client retries then gives up (RST NOT BUILT)', () => {
    const run = simulate(tcp({ requestDstPort: 9999 }));
    const tags = run.events.map((e) => e.tag);
    expect(tags.filter((x) => x === 'socket:none')).toHaveLength(4);
    expect(tags).toContain('timer:giveup');
    expect(tags).not.toContain('deliver:app');
  });

  it('switching protocol clears TCP state', () => {
    const rc = new RunController();
    rc.start(tcp());
    const udp = rc.start(defaultSimConfig('same-lan', 'UDP'));
    const f = udp.timeline.final.endpoints;
    expect([f.A?.tcpState, f.B?.tcpState, f.A?.iss, f.B?.sndNxt]).toEqual(['CLOSED', 'CLOSED', null, null]);
    expect(udp.events.some((e) => e.tag.startsWith('tcp:') || e.transition?.machine === 'tcp')).toBe(false);
  });
});
