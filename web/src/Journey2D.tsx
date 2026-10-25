import { explain, hex, packetFromFrame, type SimRun, type SimState, type SimulationEvent } from '@packetjourney/shared';
import { LAYERS, LayerGlyph, type LayerId } from './layers.tsx';
import { fmtTime } from './format.ts';
import { TcpCards } from './TcpCards.tsx';

// 2D SVG journey: the permanent WebGL fallback. Renders only snapshot + event data.

const W = 640;
const NODE_W = 128;
const KIND_LABEL: Record<string, string> = {
  syn: 'SYN', 'syn-ack': 'SYN-ACK', 'hs-ack': 'ACK', data: 'REQ', response: 'REPLY', ack: 'ACK', 'response-ack': 'ACK',
};

/** How many layers wrap the packet at this moment (1 = app data only … 4 = full frame). */
const DEPTH: [RegExp, number][] = [
  [/^app:(send|respond)$/, 1],
  [/^encap:transport$/, 2],
  [/^encap:internet$/, 3],
  [/^hop:.+:forward$/, 3],
  [/^(decap:link|verify:internet|drop:internet)$/, 3],
  [/^(decap:internet|verify:transport|socket:|drop:transport)/, 2],
  [/^(decap:transport|deliver:app|app:processed|tcp:duplicate|ack)/, 1],
  [/^(encap:link|hop:|verify:link|drop|tcp:retransmit)/, 4],
];
const depthOf = (tag: string) => DEPTH.find(([re]) => re.test(tag))?.[1] ?? 0;

function hexRun(b: readonly number[], max = 48) {
  const s = b.slice(0, max).map((x) => hex(x)).join(' ');
  return b.length > max ? `${s} … +${b.length - max} B` : s;
}

type Card = { layer: LayerId; title: string; head: number[]; tail?: number[] };

function cardsFor(ev: SimulationEvent, s: SimState): Card[] {
  const depth = depthOf(ev.tag);
  if (!depth) return [];
  const p = ev.packetId ? s.packets[ev.packetId] : undefined;
  if (!p) return ev.bytes ? [{ layer: 'app', title: `Application data · ${ev.bytes.length} B`, head: ev.bytes }] : [];
  const frame = Uint8Array.from(p.current);
  const ip = packetFromFrame(frame);
  const ihl = ((ip[0] ?? 0x45) & 0x0f) * 4;
  const seg = ip.slice(ihl);
  const tcp = ip[9] === 6;
  const l4 = tcp ? ((seg[12] ?? 0x50) >> 4) * 4 : 8;
  const payload = [...seg.slice(l4)];
  const all: Card[] = [
    { layer: 'link', title: `Ethernet II · 14 B header + ${frame.length - 14 - ip.length} B pad/FCS`, head: [...frame.slice(0, 14)], tail: [...frame.slice(14 + ip.length)] },
    { layer: 'internet', title: `IPv4 · ${ihl} B header`, head: [...ip.slice(0, ihl)] },
    { layer: 'transport', title: `${tcp ? 'TCP' : 'UDP'} · ${l4} B header`, head: [...seg.slice(0, l4)] },
    { layer: 'app', title: `Application data · ${payload.length} B`, head: payload },
  ];
  return all.slice(4 - depth);
}

function LayerCards({ cards }: { cards: Card[] }) {
  if (!cards.length) return null;
  const nest = (i: number): React.ReactNode => {
    const c = cards[i];
    if (!c) return null;
    return (
      <div className="lcard" data-testid={`lcard-${c.layer}`} style={{ '--layer': `var(--c-${c.layer})` } as React.CSSProperties}>
        <div className="lcard-head">
          <LayerGlyph layer={c.layer} size={14} /> <span className="code mono">{LAYERS[c.layer].code}</span> {c.title}
        </div>
        <p className="lcard-bytes mono" data-testid={`lbytes-${c.layer}`}>
          {hexRun(c.head)}
        </p>
        {nest(i + 1)}
        {c.tail && c.tail.length > 0 && <p className="lcard-bytes mono lcard-tail">{hexRun(c.tail)}</p>}
      </div>
    );
  };
  return (
    <div className="lcards" aria-label="Layer cards with actual bytes">
      {nest(0)}
    </div>
  );
}

const RX_TEXT = {
  transport: { pending: '◌ pending', accepted: '✓ accepted', rejected: '✕ rejected' },
  app: { pending: '◌ pending', processed: '✓ processed' },
} as const;

export function Journey2D({ run, index, onStep }: { run: SimRun; index: number; onStep: (i: number) => void }) {
  const ev = run.events[index];
  const s = run.timeline.at(index);
  const path = run.template.path;
  const xs = path.map((_, i) => 80 + (i * (W - 160)) / Math.max(1, path.length - 1));
  const xOf = (dev: string) => xs[path.indexOf(dev)] ?? xs[0] ?? 80;
  const last = run.events.length - 1;
  if (!ev) return null;

  const pkt = ev.packetId ? s.packets[ev.packetId] : undefined;
  const hop = s.activeHop && s.activeHop.packetId === ev.packetId ? s.activeHop : null;
  const marker = hop ? { x: (xOf(hop.from) + xOf(hop.to)) / 2, y: 52 } : { x: xOf(ev.device), y: 22 };
  const dropped = ev.type === 'drop' || ev.tag === 'socket:none';
  // Receiver statuses: shown once the packet is at the receiver (inbound event) or transport has decided.
  const showRx = pkt && (ev.direction === 'in' || pkt.rx.transport !== 'pending');

  return (
    <section className="journey" aria-label="2D journey">
      <svg viewBox={`0 0 ${W} 150`} className="journey-svg" role="img" aria-label={`Step ${index + 1} of ${run.events.length}: ${ev.tag} at ${ev.device}`}>
        {path.slice(0, -1).map((d, i) => {
          const next = path[i + 1] ?? d;
          const link = run.template.links.find((l) => [l.a.device, l.b.device].sort().join() === [d, next].sort().join());
          const x1 = xOf(d) + NODE_W / 2;
          const x2 = xOf(next) - NODE_W / 2;
          const active = hop && [hop.from, hop.to].sort().join() === [d, next].sort().join();
          return (
            <g key={d}>
              <line x1={x1} y1={92} x2={x2} y2={92} stroke={active ? 'var(--c-link)' : 'var(--c-hairline)'} strokeWidth={active ? 3 : 2} />
              <text x={(x1 + x2) / 2} y={112} textAnchor="middle" className="svg-label">
                {link ? `${link.id} · ${link.bps / 1e6} Mb/s` : ''}
              </text>
            </g>
          );
        })}
        {path.map((d) => {
          const dev = run.template.devices[d];
          const on = ev.device === d;
          return (
            <g key={d} transform={`translate(${xOf(d) - NODE_W / 2}, 64)`}>
              <rect width={NODE_W} height={56} rx={12} fill="var(--c-scrim)" stroke={on ? 'var(--c-transport)' : 'var(--c-hairline)'} strokeWidth={on ? 2.5 : 1} />
              <text x={NODE_W / 2} y={24} textAnchor="middle" className="svg-name">
                {d} · {dev?.kind}
              </text>
              <text x={NODE_W / 2} y={44} textAnchor="middle" className="svg-mono">
                {dev?.ifaces[0]?.ip}
              </text>
            </g>
          );
        })}
        {pkt && (
          <g transform={`translate(${marker.x - 38}, ${marker.y - 14})`} data-testid="packet-marker">
            <rect width={76} height={26} rx={7} fill="var(--c-bg1)" stroke={dropped ? 'var(--c-danger)' : `var(--c-${ev.layer})`} strokeWidth={2} />
            <text x={38} y={18} textAnchor="middle" className="svg-mono">
              {dropped ? '✕ ' : ''}
              {KIND_LABEL[pkt.kind] ?? pkt.kind}
            </text>
          </g>
        )}
      </svg>

      <div className="journey-bar">
        <div className="seg" role="group" aria-label="Step through events">
          <button type="button" aria-label="First event" disabled={index === 0} onClick={() => onStep(0)}>⏮</button>
          <button type="button" aria-label="Previous event" disabled={index === 0} onClick={() => onStep(index - 1)}>◀</button>
          <button type="button" aria-label="Next event" disabled={index === last} onClick={() => onStep(index + 1)}>▶</button>
          <button type="button" aria-label="Last event" disabled={index === last} onClick={() => onStep(last)}>⏭</button>
        </div>
        <span className="mono small muted" data-testid="journey-step">
          {index + 1} / {run.events.length} · t = {fmtTime(ev.virtualTimeMs)}
        </span>
      </div>
      <p className="journey-caption" data-testid="journey-caption" aria-live="polite">
        <span className="ev-tag mono" style={{ '--layer': `var(--c-${ev.layer})` } as React.CSSProperties}>
          {ev.tag}
        </span>{' '}
        {explain(ev)}
      </p>

      {showRx && pkt && (
        <div className="rx" data-testid="rx-status">
          <span className={`chip-rx rx-${pkt.rx.transport}`} data-testid="rx-transport">
            Transport {RX_TEXT.transport[pkt.rx.transport]}
          </span>
          <span className={`chip-rx rx-${pkt.rx.app}`} data-testid="rx-app">
            Application {RX_TEXT.app[pkt.rx.app]}
          </span>
        </div>
      )}
      {run.config.protocol === 'TCP' && <TcpCards run={run} s={s} ev={ev} />}
      <LayerCards cards={cardsFor(ev, s)} />
    </section>
  );
}
