import type { Fault, FaultTarget } from '../schemas.ts';
import type { SimConfig, SimRun } from './simulate.ts';

// Compare mode: TCP vs UDP raw echo with identical application bytes, path, links and fault. Metrics are derived
// from events only. Preamble + SFD + interframe gap are EXCLUDED from frame bytes (frames = dst MAC … FCS).

export type CompareFault = 'none' | 'drop' | 'delay' | 'corrupt';

/**
 * Both runs from one base: same request/reply bytes, endpoints, template, TTL, links. The fault targets the
 * semantic first data transmission (`packet: 'data', attempt 0`) on the given hop — never an event index.
 */
export function compareConfigs(base: SimConfig, fault: CompareFault, hop = 0): { tcp: SimConfig; udp: SimConfig } {
  const target: FaultTarget = { packet: 'data', attempt: 0, hop };
  const faults: Fault[] =
    fault === 'drop' ? [{ kind: 'drop', target }]
      : fault === 'delay' ? [{ kind: 'delay', target, delayMs: 5 }]
        : fault === 'corrupt' ? [{ kind: 'corrupt', target, mode: 'wire', offset: 0, bit: 0 }]
          : [];
  const common: SimConfig = { ...structuredClone(base), payloadMode: 'raw', close: { ...base.close, enabled: false }, faults };
  return { tcp: { ...common, protocol: 'TCP' }, udp: { ...common, protocol: 'UDP' } };
}

export type Accounting = 'delivery' | 'full';

export type CompareMetrics = {
  /** Unique application bytes delivered to applications (duplicates are never delivered twice). */
  uniqueAppBytes: number;
  retransmissions: number;
  /** Ethernet frame bytes (dst MAC … FCS, incl. headers and padding) over every link transmission counted. */
  frameBytes: number;
  framesCounted: number;
  droppedFrames: number;
  /** Virtual time of the first application delivery (ms, SIMULATED); null if nothing was delivered. */
  firstDeliveryMs: number | null;
  /** delivery: last application delivery; full: end of the whole exchange (last event). ms, SIMULATED. */
  completionMs: number | null;
  /** uniqueAppBytes × 8 / completion (bits per simulated second); null when the duration is zero or undefined. */
  goodputBps: number | null;
  /** (frameBytes − uniqueAppBytes) / frameBytes; null when no frames were counted. */
  overheadRatio: number | null;
};

const DATA_KINDS = new Set(['data', 'response']);

/**
 * delivery: only frames that carry application data (data/response and their retransmissions).
 * full: every frame of the exchange — TCP handshake, pure ACKs, data, retransmissions; UDP datagrams.
 */
export function metricsOf(run: SimRun, accounting: Accounting): CompareMetrics {
  const packets = run.timeline.final.packets;
  const counted = run.events.filter((e) => e.type === 'transmit' && e.timing && (accounting === 'full' || DATA_KINDS.has(packets[e.packetId ?? '']?.kind ?? '')));
  const frameBytes = counted.reduce((n, e) => n + (e.timing?.frameBytes ?? 0), 0);
  const deliveries = run.events.filter((e) => e.tag === 'deliver:app');
  const uniqueAppBytes = deliveries.reduce((n, e) => n + (e.bytes?.length ?? 0), 0);
  const firstDeliveryMs = deliveries[0]?.virtualTimeMs ?? null;
  const last = run.events[run.events.length - 1];
  const completionMs = accounting === 'delivery' ? (deliveries[deliveries.length - 1]?.virtualTimeMs ?? null) : (last?.virtualTimeMs ?? null);
  return {
    uniqueAppBytes,
    retransmissions: run.events.filter((e) => e.tag === 'tcp:retransmit').length,
    frameBytes,
    framesCounted: counted.length,
    droppedFrames: run.events.filter((e) => e.type === 'drop').length,
    firstDeliveryMs,
    completionMs,
    goodputBps: completionMs && completionMs > 0 ? (uniqueAppBytes * 8) / (completionMs / 1000) : null,
    overheadRatio: frameBytes > 0 ? (frameBytes - uniqueAppBytes) / frameBytes : null,
  };
}
