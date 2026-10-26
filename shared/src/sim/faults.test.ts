import { describe, expect, it } from 'vitest';
import { defaultSimConfig, simulate, type SimConfig, type SimRun } from './simulate.ts';
import { validateSimConfig } from './validate.ts';
import type { Fault, FaultTarget } from '../schemas.ts';

const tcp = (o: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig('routed', 'TCP'), ...o });
const udp = (o: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig('routed', 'UDP'), ...o });
const at = (packet: FaultTarget['packet'], hop = 0, attempt = 0): FaultTarget => ({ packet, hop, attempt });
const tags = (r: SimRun) => r.events.map((e) => e.tag);
const delivered = (r: SimRun, dev: string) => r.events.filter((e) => e.tag === 'deliver:app' && e.device === dev);
const final = (r: SimRun) => r.timeline.final;

describe('targeted faults: TCP recovery', () => {
  it('one lost data transmission is retransmitted (same seq/payload) and delivered exactly once', () => {
    const r = simulate(tcp({ faults: [{ kind: 'drop', target: at('data', 1) }] }));
    const t = tags(r);
    expect(t).toContain('fault:drop');
    expect(t).toContain('drop:fault');
    expect(t).toContain('timer:fire:rto');
    expect(t).toContain('tcp:retransmit');
    expect(delivered(r, 'B')).toHaveLength(1);
    expect(final(r).metrics.deliveredBytes).toBe(10); // Hello + World, each once
    // Retransmission reuses the original frame: identical bytes, same sequence number.
    const firstData = r.events.find((e) => e.type === 'transmit' && final(r).packets[e.packetId ?? '']?.kind === 'data');
    const retx = r.events.find((e) => e.tag === 'tcp:retransmit');
    expect(retx?.bytes).toEqual(firstData?.bytes);
    // Every attempt counts as transmitted application bytes; unique delivered bytes do not double.
    expect(final(r).metrics.appBytesSent).toBe(15); // Hello twice + World once
    // Drop happens at the next receiver of hop 1 (R2), where the engine reports it.
    expect(r.events.find((e) => e.tag === 'drop:fault')?.device).toBe('R2');
  });

  it('a lost ACK triggers a retry, the receiver discards the duplicate, re-ACKs, and delivers once', () => {
    const r = simulate(tcp({ reply: { enabled: false, text: 'World' }, faults: [{ kind: 'drop', target: at('ack') }] }));
    const t = tags(r);
    expect(t).toContain('tcp:retransmit');
    expect(t).toContain('tcp:duplicate');
    expect(delivered(r, 'B')).toHaveLength(1);
    expect(final(r).metrics.deliveredBytes).toBe(5);
    const dupIdx = t.indexOf('tcp:duplicate');
    const reAck = r.events.find((e) => e.index > dupIdx && e.tag === 'encap:transport' && e.device === 'B');
    expect(reAck?.explainArgs.flags).toBe('ACK');
  });

  it('a lost client ACK of the reply makes the server retransmit; the client delivers the reply once', () => {
    const r = simulate(tcp({ faults: [{ kind: 'drop', target: at('response-ack') }] }));
    expect(r.events.filter((e) => e.tag === 'tcp:retransmit' && e.device === 'B')).toHaveLength(1);
    expect(delivered(r, 'A')).toHaveLength(1);
  });

  it('retry exhaustion is deterministic: drops on every attempt end in give-up after maxRetries', () => {
    const faults: Fault[] = [0, 1, 2, 3].map((a) => ({ kind: 'drop', target: at('data', 0, a) }));
    const a = simulate(tcp({ faults }));
    const b = simulate(tcp({ faults }));
    expect(a.events).toEqual(b.events);
    expect(a.events.filter((e) => e.tag === 'tcp:retransmit')).toHaveLength(3);
    expect(tags(a)).toContain('timer:giveup');
    expect(final(a).endpoints.A?.app).toBe('failed');
    expect(delivered(a, 'B')).toHaveLength(0);
    // SYN 200, then data 200 doubling per retry: 400, 800, 1600 (the last timer's expiry is the give-up). SIMULATED, simplified policy.
    expect(a.events.filter((e) => e.tag === 'timer:set:rto' && e.device === 'A').map((e) => e.explainArgs.rtoMs)).toEqual([200, 200, 400, 800, 1600]);
  });
});

describe('targeted faults: UDP and delay', () => {
  it('UDP loss: missing datagram, no retry, no delivery', () => {
    const r = simulate(udp({ faults: [{ kind: 'drop', target: at('data') }] }));
    expect(delivered(r, 'B')).toHaveLength(0);
    expect(tags(r).some((x) => x.startsWith('timer') || x === 'tcp:retransmit')).toBe(false);
    expect(final(r).metrics.deliveredBytes).toBe(0);
    expect(final(r).metrics.appBytesSent).toBe(5);
  });

  it('a delayed datagram still arrives later (never labelled loss)', () => {
    const base = simulate(udp());
    const r = simulate(udp({ faults: [{ kind: 'delay', target: at('data', 2), delayMs: 5 }] }));
    const when = (x: SimRun) => delivered(x, 'B')[0]?.virtualTimeMs ?? -1;
    expect(when(r) - when(base)).toBeCloseTo(5, 6);
    expect(tags(r)).toContain('fault:delay');
    expect(tags(r).some((x) => x.startsWith('drop'))).toBe(false);
  });

  it('delay ordering is deterministic: a TCP data frame delayed past its RTO arrives after the retransmission', () => {
    const cfg = tcp({ faults: [{ kind: 'delay', target: at('data'), delayMs: 300 }] });
    const r = simulate(cfg);
    expect(simulate(cfg).events).toEqual(r.events);
    const t = tags(r);
    expect(t.indexOf('tcp:retransmit')).toBeGreaterThan(-1);
    expect(t).toContain('tcp:duplicate'); // the late original is the duplicate
    expect(delivered(r, 'B')).toHaveLength(1);
  });
});

describe('targeted faults: corruption and validation order', () => {
  it('a corrupted wire frame fails the Ethernet FCS at the next receiver and is discarded there', () => {
    const r = simulate(udp({ faults: [{ kind: 'corrupt', target: at('data'), mode: 'wire', offset: 8, bit: 0 }] }));
    const drop = r.events.find((e) => e.type === 'drop');
    expect(drop?.device).toBe('R1');
    expect(drop?.tag).toBe('drop:link');
    expect(drop?.explainArgs.reason).toBe('FCS mismatch');
    // Nothing above the link layer runs on that frame at R1, and nothing reaches B.
    expect(r.events.some((e) => e.device === 'R1' && e.packetId === drop?.packetId && (e.tag === 'verify:internet' || e.tag === 'verify:transport'))).toBe(false);
    expect(delivered(r, 'B')).toHaveLength(0);
    expect(final(r).packets[drop?.packetId ?? '']?.corrupt).toMatchObject({ mode: 'wire', bit: 0 });
  });

  it('inner corruption with a recomputed outer FCS passes link and IPv4 checks (routers forward it) and fails the transport checksum', () => {
    const r = simulate(tcp({ faults: [{ kind: 'corrupt', target: at('data'), mode: 'transport', offset: 20, bit: 3 }] }));
    const pid = r.events.find((e) => e.tag === 'fault:corrupt:transport')?.packetId;
    const onPid = r.events.filter((e) => e.packetId === pid);
    expect(onPid.filter((e) => e.tag === 'hop:R1:forward' || e.tag === 'hop:R2:forward')).toHaveLength(2);
    const rej = onPid.find((e) => e.type === 'drop');
    expect([rej?.device, rej?.tag, rej?.explainArgs.reason]).toEqual(['B', 'drop:transport', 'TCP checksum mismatch']);
    expect(onPid.some((e) => e.tag === 'verify:link' && e.device === 'B')).toBe(true);
    expect(onPid.some((e) => e.tag === 'verify:internet' && e.device === 'B')).toBe(true);
    // TCP recovers: the retransmission is clean and delivered once.
    expect(delivered(r, 'B')).toHaveLength(1);
  });

  it('faults cannot target the handshake or teardown; UDP has no ACKs; hops are bounded', () => {
    for (const p of ['syn', 'syn-ack', 'hs-ack', 'fin-client', 'ack-fin-server'] as const) {
      const issues = validateSimConfig(tcp({ faults: [{ kind: 'drop', target: at(p) }] }));
      expect(issues[0]?.message, p).toMatch(/after the connection is established/);
      expect(() => simulate(tcp({ faults: [{ kind: 'drop', target: at(p) }] }))).toThrow();
    }
    expect(validateSimConfig(udp({ faults: [{ kind: 'drop', target: at('ack') }] }))[0]?.message).toMatch(/UDP has no ACKs/);
    expect(validateSimConfig(tcp({ faults: [{ kind: 'drop', target: at('data', 3) }] }))[0]?.message).toMatch(/Hop must be 0–2/);
    expect(validateSimConfig(tcp({ faults: [{ kind: 'corrupt', target: at('data'), mode: 'wire', offset: 25, bit: 0 }] }))[0]?.message).toMatch(/25-byte/);
    expect(validateSimConfig(tcp({ faults: [{ kind: 'delay', target: at('data'), delayMs: 0 }] }))).toHaveLength(1);
  });

  it('a fault that matches no transmission changes nothing', () => {
    const base = simulate(tcp());
    const r = simulate(tcp({ faults: [{ kind: 'drop', target: at('data', 0, 2) }] })); // attempt 2 never happens
    expect(r.events.map((e) => e.tag)).toEqual(base.events.map((e) => e.tag));
  });
});
