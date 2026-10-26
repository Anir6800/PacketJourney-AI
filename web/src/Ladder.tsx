import { useMemo, useRef } from 'react';
import { flagNames, type SimRun } from '@packetjourney/shared';
import { packetSpans, type Cue } from './motion/cues.ts';
import { useMasterChild } from './motion/motion.ts';

// Ladder (sequence) diagram between the two endpoints. Each segment/datagram is one arrow, drawn by a
// stroke-dashoffset tween on the master timeline over the packet's exact presentation span.

const W = 520;
const ROW = 26;
const XL = 70;
const XR = W - 70;
const ACK_KINDS = new Set(['ack', 'hs-ack', 'response-ack', 'ack-fin-client', 'ack-fin-server']);

type Arrow = { pid: string; y: number; fromLeft: boolean; label: string; ack: boolean; lost: boolean; len: number };

export function Ladder({ run, cues, reduced }: { run: SimRun; cues: Cue[]; reduced: boolean }) {
  const svg = useRef<SVGSVGElement>(null);
  const { client, server } = run.template;
  const tcp = run.config.protocol === 'TCP';

  const arrows = useMemo(() => {
    const spans = packetSpans(cues, run.events, [client, server]);
    const out: Arrow[] = [];
    for (const [pid, s] of spans) {
      const kind = run.timeline.final.packets[pid]?.kind ?? '';
      const retx = pid.includes('#') ? ' · retransmission' : '';
      // Retransmissions (p5#r1) reuse the original frame, so their header values come from the original packet.
      const base = pid.split('#')[0] ?? pid;
      const enc = run.events.find((e) => e.packetId === base && e.tag === 'encap:transport');
      const seg = enc?.bytes ?? [];
      const label = tcp
        ? `${flagNames(seg[13] ?? 0)} seq ${enc?.explainArgs.seq ?? '?'} ack ${enc?.explainArgs.ack ?? '?'}${(enc?.explainArgs.consumes ?? 0) && !/SYN|FIN/.test(flagNames(seg[13] ?? 0)) ? ` · ${enc?.explainArgs.consumes} B` : ''}`
        : `UDP ${enc?.explainArgs.bytes ?? '?'} B`;
      const lost = s.to === '';
      const y = 30 + out.length * ROW;
      out.push({ pid, y, fromLeft: s.from === client, label: label + retx, ack: ACK_KINDS.has(kind), lost, len: Math.hypot((XR - XL) * (lost ? 0.5 : 1), ROW * 0.6) });
    }
    return out;
  }, [run, cues, client, server, tcp]);

  useMasterChild(
    (tl) => {
      const spans = packetSpans(cues, run.events, [client, server]);
      for (const a of arrows) {
        const s = spans.get(a.pid);
        const el = svg.current?.querySelector(`[data-arrow="${a.pid}"]`);
        if (!s || !el) continue;
        if (reduced) tl.set(el, { strokeDashoffset: 0 }, s.startPT);
        else tl.fromTo(el, { strokeDashoffset: a.len }, { strokeDashoffset: 0, duration: s.endPT - s.startPT, ease: 'none', immediateRender: false }, s.startPT);
        const head = svg.current?.querySelector(`[data-head="${a.pid}"]`);
        if (head) tl.fromTo(head, { opacity: 0 }, { opacity: 1, duration: 0.01, immediateRender: false }, Math.max(s.startPT, s.endPT - 0.01));
      }
    },
    [arrows, cues, reduced],
    svg,
  );

  const h = 40 + arrows.length * ROW;
  return (
    <section aria-label="Ladder diagram" className="ladder">
      <h3 className="hud-label">
        {tcp ? 'TCP' : 'UDP'} ladder · {client} ↔ {server} (end-to-end; routers not drawn) · SIMULATED
      </h3>
      <svg ref={svg} viewBox={`0 0 ${W} ${h}`} className="ladder-svg" role="img" aria-label={`${arrows.length} segments between ${client} and ${server}`} data-testid="ladder">
        <text x={XL} y={14} textAnchor="middle" className="svg-name">
          {client}
        </text>
        <text x={XR} y={14} textAnchor="middle" className="svg-name">
          {server}
        </text>
        <line x1={XL} y1={20} x2={XL} y2={h} className="ladder-life" />
        <line x1={XR} y1={20} x2={XR} y2={h} className="ladder-life" />
        {arrows.map((a) => {
          const x1 = a.fromLeft ? XL : XR;
          const full = a.fromLeft ? XR : XL;
          const x2 = a.lost ? (x1 + full) / 2 : full;
          const y2 = a.y + ROW * 0.6;
          return (
            <g key={a.pid} className={a.ack ? 'ladder-ack' : 'ladder-seg'} data-testid={`ladder-${a.pid}`}>
              {/* Initial dashoffset = length: undrawn until its cue (the timeline sets it from then on). */}
              <line x1={x1} y1={a.y} x2={x2} y2={y2} data-arrow={a.pid} strokeDasharray={a.len} style={{ strokeDashoffset: a.len }} />
              <text data-head={a.pid} x={x2 + (a.fromLeft ? -4 : 4)} y={y2 + 4} textAnchor={a.fromLeft ? 'end' : 'start'} className="svg-mono" style={{ opacity: 0 }}>
                {a.lost ? '✕' : a.fromLeft ? '▶' : '◀'}
              </text>
              <text x={(XL + XR) / 2} y={a.y + 6} textAnchor="middle" className="ladder-label">
                {a.label}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}
