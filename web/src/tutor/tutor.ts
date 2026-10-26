import type { ExplainRequest, ExplainResponse, Field, SimRun } from '@packetjourney/shared';
import { explain } from '@packetjourney/shared';

// Tutor logic (no React): request building from the current snapshot, built-in authored explanations,
// and a race-safe client for the optional live AI. The client only ever calls the fixed path /api/explain.

export type TutorKind = ExplainRequest['kind'];
type Layer = NonNullable<ExplainRequest['context']['layer']>;

const LAYER_TEXT: Record<Layer, string> = {
  app: 'The application layer is the message itself: your bytes, encoded as UTF-8. Nothing below changes them.',
  transport: 'The transport layer adds ports, which choose the application on each host. TCP also numbers bytes (seq/ack) and confirms them; UDP only adds ports, a length and an optional checksum.',
  internet: 'The internet layer (IPv4) carries the end-to-end addresses and a TTL. Routers read it to pick the next hop and decrement the TTL; they never change the endpoint addresses (no NAT here).',
  link: 'The link layer (Ethernet II) addresses the next hop on one link only. Every router builds a new frame with new MAC addresses and a new FCS.',
  physical: 'The physical layer sends the frame as bits on the wire. This simulator shows it as a teaching view; timings are SIMULATED.',
};

/** The fields each layer is mostly about (the set Story Mode highlights). */
const KEY_FIELDS = [
  'payload.data', 'tcp.srcPort', 'tcp.dstPort', 'tcp.seqNumber', 'tcp.ackNumber', 'tcp.checksum', 'udp.srcPort', 'udp.dstPort', 'udp.length', 'udp.checksum',
  'ipv4.src', 'ipv4.dst', 'ipv4.ttl', 'ipv4.protocol', 'ipv4.checksum', 'ethernet.src', 'ethernet.dst', 'ethernet.etherType', 'padding.bytes', 'fcs.crc32',
];

const COMPARE_TEXT = [
  'TCP opens a connection with a three-way handshake, numbers every byte, acknowledges what arrived and retransmits what was lost, so the application gets each byte once and in order.',
  'UDP sends each datagram on its own: no connection, no ACKs and no retransmission. A lost datagram is simply missing unless the application handles it.',
  'Both carry the same ports-and-checksum idea; which fits depends on whether the application needs reliability or prefers minimal delay and overhead. Use the Compare tab to see the event-by-event difference for your run.',
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const toField = (f: Field) => ({ id: f.id, name: clip(f.name, 80), display: clip(f.display, 160), byteStart: f.byteStart, byteEnd: f.byteEnd });

/** Bounded snapshot of facts already on screen. */
export function buildRequest(o: {
  kind: TutorKind; run: SimRun; step: number; layer: Layer | null; field: Field | null; question: string;
}): ExplainRequest {
  const s = o.run.timeline.at(o.step);
  const fields = o.run.timeline.final.fields.filter((f) => !o.layer || f.layer === o.layer).slice(0, 24).map(toField);
  const ev = o.run.events[o.step];
  const state: Record<string, string> = {};
  for (const e of Object.values(s.endpoints)) if (e.sndNxt !== null || o.run.config.protocol === 'TCP') state[e.device] = clip(`${e.tcpState} · app ${e.app}`, 60);
  return {
    kind: o.kind,
    protocol: o.run.config.protocol,
    question: clip(o.question.trim(), 300),
    context: {
      layer: o.layer,
      field: o.field ? toField(o.field) : null,
      fields,
      event: ev ? { id: ev.id, tag: ev.tag, device: ev.device, text: clip(explain(ev), 400), timeMs: ev.virtualTimeMs } : null,
      state,
    },
  };
}

/** Built-in authored explanation (works offline, no key). Every value quoted comes from the supplied facts. */
export function builtIn(req: ExplainRequest, run: SimRun): ExplainResponse {
  const c = req.context;
  const lines: string[] = [];
  const refs: string[] = [];
  if (req.kind === 'layer' && c.layer) {
    lines.push(LAYER_TEXT[c.layer]);
    const key = c.fields.filter((f) => KEY_FIELDS.includes(f.id));
    for (const f of (key.length ? key : c.fields).slice(0, 6)) {
      lines.push(`${f.name}: ${f.display}`);
      refs.push(f.id);
    }
  } else if (req.kind === 'field' && c.field) {
    const engine = run.timeline.final.fields.find((f) => f.id === c.field?.id);
    lines.push(`${c.field.name} = ${c.field.display} (frame bytes ${c.field.byteStart}–${c.field.byteEnd - 1}).`);
    if (engine) lines.push(engine.explanation);
    refs.push(c.field.id);
  } else if (req.kind === 'why' && c.event) {
    lines.push(`${c.event.tag} at ${c.event.device}: ${c.event.text}`);
    refs.push(c.event.id);
    // Walk the engine's cause links back a few steps.
    let cause = run.events.find((e) => e.id === c.event?.id)?.causeId ?? null;
    for (let i = 0; i < 4 && cause; i++) {
      const e = run.events.find((x) => x.id === cause);
      if (!e) break;
      lines.push(`Because of ${e.tag} at ${e.device}: ${explain(e)}`);
      refs.push(e.id);
      cause = e.causeId;
    }
  } else if (req.kind === 'compare') {
    lines.push(...COMPARE_TEXT);
  } else {
    lines.push('Select a layer, a field or an event first.');
  }
  return { explanation: lines.join('\n'), refs, caveats: [], source: 'built-in', grounding: 'verified' };
}

export type LiveError = { status: number; code: string };

/**
 * Race-safe live client: every call aborts the previous one and carries a request id; a response is applied only
 * if it belongs to the newest request, so a slow old answer can never overwrite a newer selection.
 */
export class TutorClient {
  private seq = 0;
  private ctrl: AbortController | null = null;
  constructor(private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  async ask(req: ExplainRequest, apply: (r: { id: number; res?: ExplainResponse; err?: LiveError }) => void): Promise<void> {
    this.ctrl?.abort();
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    const id = ++this.seq;
    try {
      const res = await this.fetchImpl('/api/explain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        signal: ctrl.signal,
      });
      const body = (await res.json().catch(() => ({}))) as Partial<ExplainResponse> & { error?: string };
      if (id !== this.seq) return; // stale
      if (!res.ok || typeof body.explanation !== 'string') return apply({ id, err: { status: res.status, code: body.error ?? 'bad-response' } });
      apply({
        id,
        res: {
          explanation: body.explanation,
          refs: Array.isArray(body.refs) ? body.refs.filter((x): x is string => typeof x === 'string') : [],
          caveats: Array.isArray(body.caveats) ? body.caveats.filter((x): x is string => typeof x === 'string') : [],
          source: 'live-ai',
          grounding: body.grounding === 'verified' ? 'verified' : 'generated',
        },
      });
    } catch {
      if (id !== this.seq || ctrl.signal.aborted) return; // superseded or cancelled: say nothing
      apply({ id, err: { status: 0, code: 'network' } });
    }
  }

  cancel() {
    this.seq++;
    this.ctrl?.abort();
  }
}
