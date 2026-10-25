import type { Field, LayerId, PacketKind } from '../schemas.ts';

// Event and state types. Events are immutable (deep-frozen); the reducer is the only way state changes.

export type AppState = 'idle' | 'sent' | 'received' | 'processed' | 'responded' | 'got-response' | 'failed';

/** Receiver-side status of one packet: transport acceptance and application processing are separate. */
export type RxStatus = { transport: 'pending' | 'accepted' | 'rejected'; app: 'pending' | 'processed' };

export type TimerRec = { generation: number; armed: boolean; deadlineMs: number | null; retries: number };

export type EndpointState = {
  device: string;
  role: 'client' | 'server';
  /** RFC 9293 state name. Handshake/close are NOT BUILT: sessions start ESTABLISHED by assumption. */
  tcpState: string;
  /** Initial send / receive sequence numbers (TCP only). */
  iss: number | null;
  irs: number | null;
  sndUna: number | null;
  sndNxt: number | null;
  rcvNxt: number | null;
  /** TCP: bytes written by the app and not yet acknowledged (queued until ESTABLISHED). Empty for UDP. */
  sendBuffer: number[];
  /** Bytes delivered to the application, in order. */
  recvBuffer: number[];
  deliveredBytes: number;
  app: AppState;
  timers: Record<string, TimerRec>;
};

export type PacketStatus = 'host' | 'link' | 'router' | 'delivered' | 'dropped' | 'discarded';
export type PacketRec = {
  id: string;
  kind: PacketKind;
  /** Frame as first transmitted by its sender (retransmissions reuse it). */
  original: number[];
  /** Frame as it currently exists (re-framed at each router). */
  current: number[];
  at: string;
  status: PacketStatus;
  attempt: number;
  rx: RxStatus;
};

export type Hop = { packetId: string; linkId: string; from: string; to: string; sendStartMs: number; sendEndMs: number; arrivalMs: number };

export type Metrics = {
  framesSent: number;
  /** Sum of frame lengths (dst MAC … FCS). */
  frameBytesSent: number;
  /** Sum of link occupancy in byte-times (preamble + SFD + frame + interframe gap). */
  onLinkBytesSent: number;
  /** Total serialization time across links, ms. */
  linkBusyMs: number;
  deliveredBytes: number;
  drops: number;
  retransmissions: number;
  completedAtMs: number | null;
};

export type Units = { app?: number[]; transport?: number[]; internet?: number[]; link?: number[] };

export type EndReason = 'complete' | 'event-cap' | 'max-duration';

export type SimState = {
  index: number;
  timeMs: number;
  endpoints: Record<string, EndpointState>;
  packets: Record<string, PacketRec>;
  activeHop: Hop | null;
  /** Encapsulation of the client's first data packet (for stack/headers views). */
  units: Units;
  fields: Field[];
  metrics: Metrics;
  end: { reason: EndReason; atMs: number } | null;
};

export type Effect =
  | { k: 'endpoint'; device: string; patch: Partial<Omit<EndpointState, 'device' | 'role' | 'timers'>> }
  | { k: 'timer'; device: string; name: string; timer: TimerRec }
  | { k: 'packet'; id: string; rec: PacketRec }
  | { k: 'packet-patch'; id: string; patch: Partial<Omit<PacketRec, 'id' | 'kind' | 'original'>> }
  | { k: 'hop'; hop: Hop | null }
  | { k: 'units'; units: Units; fields: Field[] }
  | { k: 'metric'; add: Partial<Omit<Metrics, 'completedAtMs'>> }
  | { k: 'end'; reason: EndReason; atMs: number };

export type EventType =
  | 'session' | 'tcp-state' | 'app-send' | 'route' | 'encap' | 'transmit' | 'arrive' | 'verify' | 'decap' | 'forward' | 'drop' | 'socket'
  | 'deliver' | 'app-process' | 'discard' | 'ack' | 'timer-set' | 'timer-cancel' | 'timer-fire' | 'retransmit' | 'give-up' | 'end';

export type Timing = {
  sendStartMs: number;
  sendEndMs: number;
  arrivalMs: number;
  serializationMs: number;
  propagationMs: number;
  /** Frame length metric (dst MAC … FCS). */
  frameBytes: number;
  /** Link occupancy metric: 8 (preamble+SFD) + frame + 12 (IFG). */
  onLinkBytes: number;
  bits: number;
  bps: number;
};

export type SimulationEvent = {
  id: string;
  index: number;
  /** Integer nanoseconds; exact ordering key. */
  virtualTimeNs: number;
  virtualTimeMs: number;
  /** Scheduler insertion seq: stable tie-break for equal timestamps. */
  tieBreak: number;
  flowId: string;
  packetId: string | null;
  device: string;
  iface: string | null;
  direction: 'out' | 'in' | 'local';
  layer: LayerId;
  type: EventType;
  /** Semantic tag for cue building, e.g. encap:transport, hop:R1:egress, decap:link, ack, drop. */
  tag: string;
  bytes: number[] | null;
  transition: { machine: 'tcp' | 'app' | 'timer' | 'packet'; from: string; to: string } | null;
  explainKey: string;
  explainArgs: Record<string, string | number>;
  causeId: string | null;
  timing: Timing | null;
  effects: Effect[];
};

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

const zeroMetrics: Metrics = {
  framesSent: 0, frameBytesSent: 0, onLinkBytesSent: 0, linkBusyMs: 0, deliveredBytes: 0, drops: 0, retransmissions: 0, completedAtMs: null,
};

export function initialState(endpoints: Record<string, EndpointState>): SimState {
  return deepFreeze({ index: -1, timeMs: 0, endpoints, packets: {}, activeHop: null, units: {}, fields: [], metrics: zeroMetrics, end: null });
}

export function reduce(s: SimState, e: SimulationEvent): SimState {
  let { endpoints, packets, activeHop, units, fields, metrics, end } = s;
  for (const f of e.effects) {
    switch (f.k) {
      case 'endpoint': {
        const cur = endpoints[f.device];
        if (cur) endpoints = { ...endpoints, [f.device]: { ...cur, ...f.patch } };
        break;
      }
      case 'timer': {
        const cur = endpoints[f.device];
        if (cur) endpoints = { ...endpoints, [f.device]: { ...cur, timers: { ...cur.timers, [f.name]: f.timer } } };
        break;
      }
      case 'packet':
        packets = { ...packets, [f.id]: f.rec };
        break;
      case 'packet-patch': {
        const cur = packets[f.id];
        if (cur) packets = { ...packets, [f.id]: { ...cur, ...f.patch } };
        break;
      }
      case 'hop':
        activeHop = f.hop;
        break;
      case 'units':
        units = f.units;
        fields = f.fields;
        break;
      case 'metric': {
        const m = { ...metrics };
        for (const [k, v] of Object.entries(f.add) as [keyof typeof f.add, number][]) m[k] = m[k] + v;
        metrics = m;
        break;
      }
      case 'end':
        end = { reason: f.reason, atMs: f.atMs };
        metrics = { ...metrics, completedAtMs: f.atMs };
        break;
    }
  }
  return deepFreeze({ index: e.index, timeMs: e.virtualTimeMs, endpoints, packets, activeHop, units, fields, metrics, end });
}

/**
 * Snapshot access by event index or virtual time, using checkpoints every `every` events so
 * backward/forward seeks replay at most `every` events.
 */
export class SnapshotTimeline {
  private checkpoints: SimState[] = [];
  readonly final: SimState;

  constructor(
    readonly initial: SimState,
    readonly events: readonly SimulationEvent[],
    private every = 16,
  ) {
    let s = initial;
    events.forEach((e, i) => {
      if (i % every === 0) this.checkpoints.push(s);
      s = reduce(s, e);
    });
    this.final = s;
  }

  /** State after applying events[0..index]; index −1 = initial. */
  at(index: number): SimState {
    if (index < 0) return this.initial;
    const i = Math.min(index, this.events.length - 1);
    const cp = Math.floor(i / this.every);
    let s = this.checkpoints[cp] ?? this.initial;
    for (let j = cp * this.every; j <= i; j++) {
      const e = this.events[j];
      if (e) s = reduce(s, e);
    }
    return s;
  }

  /** Index of the last event with virtualTimeMs ≤ t (all equal-time events included). */
  indexAtTime(tMs: number): number {
    let lo = 0;
    let hi = this.events.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((this.events[mid]?.virtualTimeMs ?? Infinity) <= tMs) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  atTime(tMs: number): SimState {
    return this.at(this.indexAtTime(tMs));
  }
}
