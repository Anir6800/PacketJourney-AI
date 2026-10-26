import type { SimulationEvent } from '@packetjourney/shared';

// Pure cue builder: events → presentation cues on a presentation-time axis (PT, seconds at 1×).
// Virtual time (VT) comes only from the engine. A cue whose VT span is zero still gets PT so it can be
// seen: that PT is a presentation-only teaching hold, labelled in the UI and never counted in metrics.

export type CueKind = 'typeOn' | 'wrap' | 'unwrap' | 'transmit' | 'hop' | 'ack' | 'drop' | 'retransmit' | 'state';

export type Cue = {
  cueId: string;
  eventId: string;
  index: number;
  kind: CueKind;
  /** Virtual time span in ms (SIMULATED). transmit: send start → arrival; others: the event instant. */
  startVT: number;
  endVT: number;
  /** Presentation time span in seconds at 1×. */
  startPT: number;
  endPT: number;
  /** True when the VT span is zero: the PT is a teaching hold, presentation-only. */
  hold: boolean;
  targets: { device: string; packetId: string | null; link: string | null; layer: string };
};

/** Presentation durations at 1× (seconds). Wrap/unwrap sit in the 350–600 ms band. */
export const CUE_PT: Record<CueKind, number> = {
  typeOn: 0.6,
  wrap: 0.5,
  unwrap: 0.45,
  transmit: 1.2,
  hop: 0.5,
  ack: 0.4,
  drop: 0.8,
  retransmit: 0.6,
  state: 0.3,
};

export function kindOf(e: Pick<SimulationEvent, 'tag' | 'type'>): CueKind {
  const t = e.tag;
  if (/^app:(send|respond)$/.test(t)) return 'typeOn';
  if (t.startsWith('encap:')) return 'wrap';
  if (t.startsWith('decap:')) return 'unwrap';
  if (e.type === 'transmit') return 'transmit';
  if (e.type === 'arrive' || e.type === 'forward' || e.type === 'route') return 'hop';
  if (t === 'ack' || t === 'ack:duplicate') return 'ack';
  if (t === 'tcp:retransmit') return 'retransmit';
  if (e.type === 'drop' || t === 'socket:none' || t === 'tcp:ignored') return 'drop';
  return 'state';
}

export function buildCues(events: readonly SimulationEvent[]): Cue[] {
  let pt = 0;
  return events.map((e) => {
    const kind = kindOf(e);
    const startVT = e.timing ? e.timing.sendStartMs : e.virtualTimeMs;
    const endVT = e.timing ? e.timing.arrivalMs : e.virtualTimeMs;
    const d = CUE_PT[kind];
    const cue: Cue = {
      cueId: `c${e.index}`,
      eventId: e.id,
      index: e.index,
      kind,
      startVT,
      endVT,
      startPT: round(pt),
      endPT: round(pt + d),
      hold: endVT === startVT,
      targets: { device: e.device, packetId: e.packetId, link: e.timing ? linkOf(e) : null, layer: e.layer },
    };
    pt += d;
    return cue;
  });
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
const linkOf = (e: SimulationEvent) => (e.effects.find((f) => f.k === 'hop') as { hop?: { linkId?: string } } | undefined)?.hop?.linkId ?? null;

/** Total mapped span (seconds at 1×): the master timeline's duration. */
export const spanOf = (cues: readonly Cue[]) => cues[cues.length - 1]?.endPT ?? 0;

export type CuePos = { index: number; progress: number; vt: number; cue: Cue | null };

/** Where presentation time `pt` falls: event index, progress within its cue and the exact virtual time. */
export function locate(cues: readonly Cue[], pt: number): CuePos {
  if (!cues.length) return { index: -1, progress: 0, vt: 0, cue: null };
  let lo = 0;
  let hi = cues.length - 1;
  // Last cue with startPT ≤ pt.
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((cues[mid]?.startPT ?? Infinity) <= pt) lo = mid;
    else hi = mid - 1;
  }
  const cue = cues[lo] ?? null;
  if (!cue) return { index: -1, progress: 0, vt: 0, cue: null };
  const span = cue.endPT - cue.startPT;
  const progress = span > 0 ? Math.min(1, Math.max(0, (pt - cue.startPT) / span)) : 1;
  return { index: cue.index, progress, vt: cue.startVT + (cue.endVT - cue.startVT) * progress, cue };
}

/** Presentation time at which event `i` starts (used for previous/next/scrub-to-event). */
export const ptOfEvent = (cues: readonly Cue[], i: number) => cues[Math.max(0, Math.min(cues.length - 1, i))]?.startPT ?? 0;

/** Ladder spans: per packet, from its first transmit to its last cue at the destination host. */
export function packetSpans(cues: readonly Cue[], events: readonly SimulationEvent[], endpoints: readonly string[]) {
  const out = new Map<string, { startPT: number; endPT: number; from: string; to: string }>();
  for (const c of cues) {
    const e = events[c.index];
    const pid = c.targets.packetId;
    if (!e || !pid) continue;
    const cur = out.get(pid);
    if (c.kind === 'transmit' && !cur && endpoints.includes(e.device)) out.set(pid, { startPT: c.startPT, endPT: c.endPT, from: e.device, to: '' });
    else if (cur && endpoints.includes(e.device) && e.device !== cur.from && e.direction === 'in') {
      cur.endPT = Math.max(cur.endPT, c.endPT);
      cur.to = e.device;
    }
  }
  return out;
}
