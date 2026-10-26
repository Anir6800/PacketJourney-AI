import { describe, expect, it } from 'vitest';
import { compareConfigs, metricsOf } from './compare.ts';
import { defaultSimConfig, simulate, type SimRun } from './simulate.ts';

const base = defaultSimConfig('routed', 'TCP');
const both = (f: Parameters<typeof compareConfigs>[1], hop = 0) => {
  const c = compareConfigs(base, f, hop);
  return { tcp: simulate(c.tcp), udp: simulate(c.udp), c };
};
const kindOf = (r: SimRun, pid: string | null) => r.timeline.final.packets[pid ?? '']?.kind;

describe('compare mode', () => {
  it('identical inputs except the transport; the same fault hits the first data transmission in both', () => {
    const { tcp, udp, c } = both('drop', 1);
    expect({ ...c.tcp, protocol: 'x' }).toEqual({ ...c.udp, protocol: 'x' });
    for (const r of [tcp, udp]) {
      const f = r.events.filter((e) => e.type === 'fault');
      expect(f).toHaveLength(1);
      expect(kindOf(r, f[0]?.packetId ?? null)).toBe('data');
      expect(f[0]?.explainArgs).toMatchObject({ kind: 'data', attempt: 0, hop: 1 });
    }
    // Event indexes differ (TCP has a handshake first): matching is semantic, not by index.
    expect(tcp.events.find((e) => e.type === 'fault')?.index).not.toBe(udp.events.find((e) => e.type === 'fault')?.index);
  });

  it('metrics are derived from events: recomputed independently here', () => {
    const { tcp } = both('none');
    const m = metricsOf(tcp, 'full');
    const tx = tcp.events.filter((e) => e.type === 'transmit');
    expect(m.frameBytes).toBe(tx.reduce((n, e) => n + (e.bytes?.length ?? 0), 0)); // frames exclude preamble/IFG
    expect(m.framesCounted).toBe(tx.length);
    expect(m.uniqueAppBytes).toBe(10);
    expect(m.firstDeliveryMs).toBe(tcp.events.find((e) => e.tag === 'deliver:app')?.virtualTimeMs);
    expect(m.completionMs).toBe(tcp.events[tcp.events.length - 1]?.virtualTimeMs);
    expect(m.goodputBps).toBeCloseTo((10 * 8) / ((m.completionMs ?? 1) / 1000), 6);
    expect(m.overheadRatio).toBeCloseTo((m.frameBytes - 10) / m.frameBytes, 9);
  });

  it('pure ACK (and handshake) bytes count in full accounting only', () => {
    const { tcp } = both('none');
    const full = metricsOf(tcp, 'full');
    const deliv = metricsOf(tcp, 'delivery');
    const ackBytes = tcp.events
      .filter((e) => e.type === 'transmit' && ['ack', 'response-ack', 'hs-ack', 'syn', 'syn-ack'].includes(kindOf(tcp, e.packetId) ?? ''))
      .reduce((n, e) => n + (e.timing?.frameBytes ?? 0), 0);
    expect(ackBytes).toBeGreaterThan(0);
    expect(full.frameBytes - deliv.frameBytes).toBe(ackBytes);
  });

  it('a TCP duplicate transmission does not increase unique delivered bytes', () => {
    const c = compareConfigs({ ...base, reply: { enabled: false, text: 'World' } }, 'none');
    const r = simulate({ ...c.tcp, faults: [{ kind: 'drop', target: { packet: 'ack', attempt: 0, hop: 0 } }] });
    const m = metricsOf(r, 'full');
    expect(m.retransmissions).toBe(1);
    expect(r.events.some((e) => e.tag === 'tcp:duplicate')).toBe(true);
    expect(m.uniqueAppBytes).toBe(5);
  });

  it('UDP loss: nothing delivered, no retransmission, no goodput (no delivery time)', () => {
    const { udp, tcp } = both('drop');
    const u = metricsOf(udp, 'delivery');
    expect([u.uniqueAppBytes, u.retransmissions, u.firstDeliveryMs, u.completionMs, u.goodputBps]).toEqual([0, 0, null, null, null]);
    expect(u.droppedFrames).toBe(1);
    const t = metricsOf(tcp, 'delivery');
    expect([t.uniqueAppBytes, t.retransmissions]).toEqual([10, 1]);
  });
});
