import { describe, expect, it } from 'vitest';
import { verifyInternetChecksum } from '../checksum.ts';
import { defaultSimConfig, simulate, type SimConfig } from './simulate.ts';
import { reduce, type SimState } from './state.ts';
import { EventQueue } from './queue.ts';
import { RunController, sameConfig } from './run.ts';
import { EXPLAIN_KEYS, explain } from './explain.ts';

// Routed TCP base; template switches go through defaultSimConfig so endpoints match the template.
const cfg = (o: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig('routed', 'TCP'), ...o });
const tags = (c: SimConfig) => simulate(c).events.map((e) => e.tag);
const ALL: SimConfig[] = (['same-lan', 'routed'] as const).flatMap((template) =>
  (['TCP', 'UDP'] as const).map((protocol) => defaultSimConfig(template, protocol)),
);

describe('scheduler', () => {
  it('equal timestamps pop in insertion order; earlier time first', () => {
    const q = new EventQueue();
    const out: string[] = [];
    for (let i = 0; i < 50; i++) q.push(i % 3 === 0 ? 5 : 10, () => out.push(`${i % 3 === 0 ? 5 : 10}:${i}`));
    while (q.size) q.pop()?.run();
    const fives = out.filter((s) => s.startsWith('5:'));
    expect(out.slice(0, fives.length)).toEqual(fives);
    const seqs = (p: string) => out.filter((s) => s.startsWith(p)).map((s) => Number(s.split(':')[1]));
    for (const p of ['5:', '10:']) expect(seqs(p)).toEqual([...seqs(p)].sort((a, b) => a - b));
  });
});

describe('determinism and ordering', () => {
  for (const c of ALL) {
    it(`${c.template}/${c.protocol}: same config + seed → identical events and bytes`, () => {
      const a = simulate(c);
      const b = simulate(structuredClone(c));
      expect(a.events).toEqual(b.events);
      expect(a.timeline.final).toEqual(b.timeline.final);
    });
    it(`${c.template}/${c.protocol}: time never decreases; ties keep scheduler order; ids/causes valid`, () => {
      const { events } = simulate(c);
      events.forEach((e, i) => {
        expect(e.index).toBe(i);
        expect(e.id).toBe(`e${i}`);
        expect(e.tag.length).toBeGreaterThan(0);
        expect(EXPLAIN_KEYS).toContain(e.explainKey);
        expect(explain(e)).not.toMatch(/\{\w+\}/);
        if (e.causeId) expect(Number(e.causeId.slice(1))).toBeLessThan(i);
        const prev = events[i - 1];
        if (prev) {
          expect(e.virtualTimeNs).toBeGreaterThanOrEqual(prev.virtualTimeNs);
          if (e.virtualTimeNs === prev.virtualTimeNs) expect(e.tieBreak).toBeGreaterThanOrEqual(prev.tieBreak);
        }
      });
      expect(Object.isFrozen(events[0])).toBe(true);
      expect(Object.isFrozen(events[0]?.effects)).toBe(true);
    });
  }
  it('different seed changes numbers but not structure', () => {
    const a = simulate(cfg({ seed: 1 }));
    const b = simulate(cfg({ seed: 2 }));
    expect(a.events.map((e) => e.tag)).toEqual(b.events.map((e) => e.tag));
    expect(a.events.map((e) => e.bytes)).not.toEqual(b.events.map((e) => e.bytes));
  });
});

describe('snapshots', () => {
  for (const c of [...ALL, cfg({ faults: [{ kind: 'loss', packet: 'response-ack', count: 1 }] })]) {
    it(`${c.template}/${c.protocol}${c.faults.length ? '+loss' : ''}: checkpointed snapshotAt equals forward execution, any seek order`, () => {
      const { events, timeline } = simulate(c);
      const forward: SimState[] = [];
      let s = timeline.initial;
      for (const e of events) forward.push((s = reduce(s, e)));
      const order = events.map((_, i) => i).reverse().concat([0, Math.floor(events.length / 2), 3, events.length - 1]);
      for (const i of order) expect(timeline.at(i)).toEqual(forward[i]);
      expect(timeline.final).toEqual(forward.at(-1));
      expect(timeline.at(-1)).toBe(timeline.initial);
    });
  }
  it('snapshotAt(time) includes every event at that exact time', () => {
    const { events, timeline } = simulate(cfg());
    const t = events[3]?.virtualTimeMs ?? 0;
    const last = events.filter((e) => e.virtualTimeMs <= t).at(-1);
    expect(timeline.atTime(t).index).toBe(last?.index);
    expect(timeline.atTime(-1).index).toBe(-1);
  });
});

describe('playback speed cannot change virtual timing', () => {
  it('stepping wall-clock at different speeds ends on the same final snapshot and metrics', () => {
    const run = simulate(cfg());
    const endMs = run.events.at(-1)?.virtualTimeMs ?? 0;
    const finals = [0.25, 1, 8].map((speed) => {
      // ponytail: stand-in for the playback clock (later phase): virtual = wall × speed, clamped.
      let wall = 0;
      let snap = run.timeline.atTime(0);
      while (snap.index < run.events.length - 1) {
        wall += 16;
        snap = run.timeline.atTime(Math.min(endMs, wall * speed));
      }
      return snap;
    });
    for (const f of finals) {
      expect(f).toEqual(run.timeline.final);
      expect(f.metrics).toEqual(run.timeline.final.metrics);
    }
    expect(simulate(cfg()).events).toEqual(run.events);
  });
});

describe('timing (SIMULATED)', () => {
  it('serialization = on-link bits / bps; send-start, send-end and arrival stored separately', () => {
    const tx = simulate(defaultSimConfig('same-lan', 'TCP')).events.find((e) => e.type === 'transmit');
    const tm = tx?.timing;
    expect(tm?.frameBytes).toBe(64);
    expect(tm?.onLinkBytes).toBe(8 + 64 + 12);
    expect(tm?.bits).toBe(672);
    expect(tm?.serializationMs).toBeCloseTo(672 / 100e6 * 1e3, 12); // 6.72 µs at 100 Mb/s
    expect(tm?.sendEndMs).toBeCloseTo((tm?.sendStartMs ?? 0) + (tm?.serializationMs ?? 0), 12);
    expect(tm?.arrivalMs).toBeCloseTo((tm?.sendEndMs ?? 0) + 0.0005, 12);
  });
  it('routed WAN hop: 10 Mb/s serialization and 2 ms propagation', () => {
    const tx = simulate(cfg()).events.find((e) => e.tag === 'hop:R1:egress');
    expect(tx?.timing?.serializationMs).toBeCloseTo(0.0672, 12);
    expect(tx?.timing?.propagationMs).toBe(2);
  });
  it('frame-length metric vs link-occupancy metric', () => {
    const m = simulate(cfg()).timeline.final.metrics;
    expect(m.onLinkBytesSent).toBe(m.frameBytesSent + 20 * m.framesSent);
  });
});

describe('protocol flow', () => {
  it('routed TCP: forwarding rewrites TTL, checksum and MACs only', () => {
    const { events } = simulate(cfg());
    const first = events.find((e) => e.packetId === 'p1' && e.tag === 'hop:A:egress')?.bytes ?? [];
    const second = events.find((e) => e.packetId === 'p1' && e.tag === 'hop:R1:egress')?.bytes ?? [];
    expect(first[22]).toBe(64);
    expect(second[22]).toBe(63);
    expect(verifyInternetChecksum(Uint8Array.from(second.slice(14, 34)))).toBe(true);
    expect(second.slice(26, 34)).toEqual(first.slice(26, 34)); // IP addresses unchanged
    expect(second.slice(0, 12)).not.toEqual(first.slice(0, 12)); // new MACs
    expect(second.slice(34, -4)).toEqual(first.slice(34, -4)); // transport + payload (+pad) untouched
    expect(second.slice(-4)).not.toEqual(first.slice(-4)); // FCS recomputed for the new header
  });
  it('TCP: data delivered, ACKed, response delivered, timers disarmed', () => {
    const { timeline } = simulate(cfg());
    const f = timeline.final;
    expect(f.endpoints.B?.recvBuffer).toEqual([...new TextEncoder().encode('Hello')]);
    expect(f.endpoints.A?.recvBuffer).toEqual([...new TextEncoder().encode('World')]);
    expect(f.endpoints.A?.app).toBe('got-response');
    expect(f.endpoints.A?.sendBuffer).toEqual([]);
    expect(f.endpoints.B?.sendBuffer).toEqual([]);
    expect(f.endpoints.A?.timers.rto?.armed).toBe(false);
    expect(f.endpoints.B?.timers.rto?.armed).toBe(false);
    expect(f.end?.reason).toBe('complete');
    expect(f.metrics.deliveredBytes).toBe(5 + 5);
  });
  it('semantic tags cover encapsulation, hops, decap and ACK', () => {
    const t = tags(cfg());
    for (const tag of ['tcp:state:LISTEN', 'tcp:connect', 'tcp:state:SYN-SENT', 'tcp:state:SYN-RECEIVED', 'tcp:state:ESTABLISHED', 'app:send', 'encap:transport', 'encap:internet', 'encap:link', 'hop:A:egress', 'hop:R1:ingress', 'hop:R1:forward', 'hop:R1:egress', 'hop:B:ingress', 'decap:link', 'decap:internet', 'decap:transport', 'deliver:app', 'ack', 'timer:set:rto', 'timer:cancel:rto', 'app:respond', 'end:complete'])
      expect(t).toContain(tag);
  });
  it('UDP: no ACKs or timers', () => {
    const t = tags(cfg({ protocol: 'UDP' }));
    expect(t.some((x) => x.startsWith('ack') || x.startsWith('timer'))).toBe(false);
    expect(t.filter((x) => x === 'deliver:app')).toHaveLength(2);
  });
});

describe('faults and bounds', () => {
  it('lost ACK of the response → one retransmission, duplicate discarded, re-ACKed', () => {
    const run = simulate(cfg({ faults: [{ kind: 'loss', packet: 'response-ack', count: 1 }] }));
    const t = run.events.map((e) => e.tag);
    expect(t).toContain('drop');
    expect(t.filter((x) => x === 'timer:fire:rto')).toHaveLength(1);
    expect(t).toContain('tcp:retransmit');
    expect(t).toContain('tcp:duplicate');
    expect(run.timeline.final.endpoints.A?.deliveredBytes).toBe(5); // not delivered twice
    expect(run.timeline.final.metrics.retransmissions).toBe(1);
    expect(run.timeline.final.end?.reason).toBe('complete');
  });
  it('persistent loss is bounded by maxRetries, with exponential backoff', () => {
    const run = simulate(cfg({ faults: [{ kind: 'loss', packet: 'data', count: 10 }] }));
    const t = run.events.map((e) => e.tag);
    expect(t.filter((x) => x === 'tcp:retransmit')).toHaveLength(3);
    expect(t).toContain('timer:giveup');
    // Bound includes the 3-way handshake (~30 events) added in phase 05.
    expect(run.events.length).toBeLessThan(120);
    const sets = run.events.filter((e) => e.tag === 'timer:set:rto' && e.packetId?.startsWith('p4')).map((e) => e.explainArgs.rtoMs);
    expect(sets).toEqual([200, 400, 800, 1600]);
    expect(run.timeline.final.endpoints.A?.app).toBe('failed');
  });
  it('event cap stops the run', () => {
    const run = simulate(cfg({ maxEvents: 20 }));
    expect(run.events).toHaveLength(20);
    expect(run.events.at(-1)?.tag).toBe('end:event-cap');
  });
  it('maximum virtual duration stops the run', () => {
    const run = simulate(cfg({ maxDurationMs: 1 }));
    expect(run.events.at(-1)?.tag).toBe('end:max-duration');
    expect(run.events.at(-1)?.virtualTimeMs).toBe(1);
    expect(run.events.every((e) => e.virtualTimeMs <= 1)).toBe(true);
  });
  it('cancelled timers neither emit events nor extend the run', () => {
    const run = simulate(cfg());
    expect(run.events.some((e) => e.tag === 'timer:fire:rto')).toBe(false);
    expect(run.timeline.final.end?.atMs).toBeLessThan(200);
  });
});

describe('run lifecycle', () => {
  it('config is frozen at start; caller edits do not leak in', () => {
    const c = cfg();
    const run = simulate(c);
    c.request = 'changed';
    expect(run.config.request).toBe('Hello');
    expect(Object.isFrozen(run.config)).toBe(true);
  });
  it('new run cancels prior state; stale callbacks are no-ops; dirty tracking', () => {
    const rc = new RunController();
    const first = rc.start(cfg());
    let hits = 0;
    const old = rc.bind(first.runId, () => hits++);
    old();
    expect(hits).toBe(1);
    const second = rc.start(cfg({ protocol: 'UDP' }));
    old();
    expect(hits).toBe(1);
    expect(rc.active?.runId).toBe(second.runId);
    expect(rc.isDirty(cfg({ protocol: 'UDP' }))).toBe(false);
    expect(rc.isDirty(cfg())).toBe(true);
    rc.reset();
    expect(rc.active).toBeNull();
    expect(sameConfig({ ...cfg() }, Object.fromEntries(Object.entries(cfg()).reverse()) as SimConfig)).toBe(true);
  });
  it('rejects invalid payloads instead of truncating', () => {
    expect(() => simulate(cfg({ request: 'x'.repeat(257) }))).toThrow(/Nothing was truncated/);
  });
});
