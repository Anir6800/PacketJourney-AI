import { useState } from 'react';
import { explain, hex, iface, packetFromFrame, routeText, type SimRun, type SimState, type SimulationEvent } from '@packetjourney/shared';
import { Segmented } from './ui.tsx';
import { LAYERS, LayerGlyph, type LayerId } from './layers.tsx';
import { fmtTime } from './format.ts';
import { TcpCards } from './TcpCards.tsx';
import { depthOf } from './scene/model.ts';

// 2D SVG journey: the permanent WebGL fallback. Renders only snapshot + event data.

const W = 760;
const NODE_W = 120;
const KIND_LABEL: Record<string, string> = {
  syn: 'SYN', 'syn-ack': 'SYN-ACK', 'hs-ack': 'ACK', data: 'REQ', response: 'REPLY', ack: 'ACK', 'response-ack': 'ACK',
  'fin-client': 'FIN', 'ack-fin-client': 'ACK', 'fin-server': 'FIN', 'ack-fin-server': 'ACK',
};

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

type Scope = 'process' | 'host' | 'hop';

const macAt = (b: readonly number[], at: number) => b.slice(at, at + 6).map((x) => x.toString(16).padStart(2, '0')).join(':');
const ipAt = (b: readonly number[], at: number) => b.slice(at, at + 4).join('.');

/** Scope overlay text. Every value is read from the current frame bytes or the run's fixed topology. */
function ScopePanel({ run, scope, ev, frame, linkId }: { run: SimRun; scope: Scope; ev: SimulationEvent; frame: readonly number[] | null; linkId: string | null }) {
  const { client, server } = run.config.endpoints;
  const tpl = run.template;
  const cIp = tpl.devices[tpl.client]?.ifaces[0]?.ip ?? client.ip;
  const sIp = tpl.devices[tpl.server]?.ifaces[0]?.ip ?? server.ip;
  const isTcp = run.config.protocol === 'TCP';
  const link = tpl.links.find((l) => l.id === linkId);
  const dev = tpl.devices[ev.device];
  const ends = link ? [link.a, link.b].map((e) => ({ e, i: iface(tpl, e) })) : [];
  return (
    <div className="scope-panel small" data-testid="scope-panel" data-scope={scope}>
      {scope === 'process' && (
        <p>
          <strong>Process ↔ process:</strong> ports choose the application — client app on {cIp}:<span className="mono">{client.port}</span> ⇄ echo app on{' '}
          {sIp}:<span className="mono">{run.config.requestDstPort}</span>.{' '}
          {isTcp
            ? 'The TCP connection is end-to-end: only the two endpoints keep TCP state; routers forward its segments and never take part in the handshake.'
            : 'UDP has no connection: each datagram is delivered independently to the bound port.'}
        </p>
      )}
      {scope === 'host' && (
        <p>
          <strong>Host ↔ host:</strong>{' '}
          {frame ? (
            <>
              this packet carries source <span className="mono" data-testid="scope-src-ip">{ipAt(frame, 26)}</span> → destination{' '}
              <span className="mono" data-testid="scope-dst-ip">{ipAt(frame, 30)}</span>, TTL <span className="mono" data-testid="scope-ttl">{frame[22]}</span>.
            </>
          ) : (
            <>endpoints {cIp} ⇄ {sIp}.</>
          )}{' '}
          Routers never change these addresses (no NAT); only TTL and the header checksum change.
        </p>
      )}
      {scope === 'hop' && (
        <>
          <p>
            <strong>Hop ↔ hop:</strong> link <span className="mono">{link?.id}</span>{' '}
            {ends.map(({ e, i }, k) => (
              <span key={k} className="mono">
                {k ? ' ⇄ ' : ''}
                {e.device}.{e.iface} {i.ip}/{i.prefixLength} {i.mac}
              </span>
            ))}
            .
          </p>
          {frame && (
            <p>
              Current frame: source MAC <span className="mono" data-testid="scope-src-mac">{macAt(frame, 6)}</span> → destination MAC{' '}
              <span className="mono" data-testid="scope-dst-mac">{macAt(frame, 0)}</span>, FCS{' '}
              <span className="mono">{frame.slice(-4).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}</span>. Routers rebuild the Ethernet header and FCS on every
              hop.
            </p>
          )}
          <p className="muted" data-testid="arp-note">
            ARP caches are prepopulated (ARP request/reply NOT BUILT); each interface already knows its neighbour's MAC.
          </p>
          {dev && (
            <details className="routes">
              <summary>Route table of {dev.id}</summary>
              <ul className="mono">
                {dev.routes.map((r) => {
                  const text = routeText(r);
                  return (
                    <li key={text} data-hot={ev.tag === 'route:lookup' && ev.explainArgs.route === text ? '' : undefined}>
                      {text}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

export function Journey2D({ run, index, onStep, selectedDevice, onSelectDevice }: {
  run: SimRun;
  index: number;
  onStep: (i: number) => void;
  selectedDevice: string | null;
  onSelectDevice: (id: string) => void;
}) {
  const [scope, setScope] = useState<Scope>('hop');
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
  const links = run.template.links;
  const curLink = hop
    ? links.find((l) => l.id === hop.linkId)
    : (links.find((l) => [l.a, l.b].some((e) => e.device === ev.device && e.iface === ev.iface)) ??
      links.find((l) => l.a.device === ev.device || l.b.device === ev.device));
  const endpoints = [run.template.client, run.template.server];
  const scopeColor = { process: 'var(--c-app)', host: 'var(--c-internet)', hop: 'var(--c-link)' }[scope];
  const xa = xOf(run.template.client);
  const xb = xOf(run.template.server);

  return (
    <section className="journey" aria-label="2D journey">
      <Segmented
        label="Delivery scope"
        value={scope}
        onChange={setScope}
        options={[
          { value: 'process', label: 'Process ↔ process' },
          { value: 'host', label: 'Host ↔ host' },
          { value: 'hop', label: 'Hop ↔ hop' },
        ]}
      />
      <svg viewBox={`0 0 ${W} 150`} className="journey-svg" role="group" aria-label={`Step ${index + 1} of ${run.events.length}: ${ev.tag} at ${ev.device}; scope ${scope}`}>
        {scope !== 'hop' && (
          <path
            d={`M ${xa} 64 C ${xa} 6, ${xb} 6, ${xb} 64`}
            fill="none"
            stroke={scopeColor}
            strokeWidth={2}
            strokeDasharray="6 5"
            data-testid="scope-arc"
          />
        )}
        {path.slice(0, -1).map((d, i) => {
          const next = path[i + 1] ?? d;
          const link = links.find((l) => [l.a.device, l.b.device].sort().join() === [d, next].sort().join());
          const x1 = xOf(d) + NODE_W / 2;
          const x2 = xOf(next) - NODE_W / 2;
          const active = Boolean(hop && link?.id === hop.linkId);
          const scoped = scope === 'hop' && link?.id === curLink?.id;
          return (
            <g key={d} data-testid={`svg-link-${link?.id}`} data-scoped={scoped ? '' : undefined}>
              <line x1={x1} y1={92} x2={x2} y2={92} stroke={scoped || active ? 'var(--c-link)' : 'var(--c-hairline)'} strokeWidth={scoped || active ? 3.5 : 2} />
              {/* Below the node row: the gap between nodes is narrower than the label. */}
              <text x={(x1 + x2) / 2} y={140} textAnchor="middle" className="svg-label">
                {link ? `${link.id} · ${link.bps / 1e6} Mb/s` : ''}
              </text>
            </g>
          );
        })}
        {path.map((d) => {
          const dev = run.template.devices[d];
          const on = ev.device === d;
          const isEnd = endpoints.includes(d);
          const dim = scope !== 'hop' && !isEnd;
          const scopedEnd = scope !== 'hop' && isEnd;
          return (
            <g
              key={d}
              transform={`translate(${xOf(d) - NODE_W / 2}, 64)`}
              opacity={dim ? 0.5 : 1}
              role="button"
              tabIndex={0}
              className="svg-node"
              data-testid={`svg-node-${d}`}
              aria-label={`Select device ${d} (${dev?.kind ?? 'host'})`}
              aria-pressed={selectedDevice === d}
              onClick={() => onSelectDevice(d)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onSelectDevice(d);
              }}
            >
              <rect
                width={NODE_W}
                height={56}
                rx={12}
                fill="var(--c-scrim)"
                stroke={on ? 'var(--c-transport)' : scopedEnd ? scopeColor : 'var(--c-hairline)'}
                strokeWidth={on || scopedEnd ? 2.5 : 1}
              />
              <text x={NODE_W / 2} y={24} textAnchor="middle" className="svg-name">
                {d} · {dev?.kind}
              </text>
              <text x={NODE_W / 2} y={44} textAnchor="middle" className="svg-mono">
                {dev?.kind === 'router' ? `${dev.ifaces.length} interfaces` : dev?.ifaces[0]?.ip}
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
      <ScopePanel run={run} scope={scope} ev={ev} frame={pkt?.current ?? null} linkId={curLink?.id ?? null} />
      {run.config.protocol === 'TCP' && <TcpCards run={run} s={s} ev={ev} />}
      <LayerCards cards={cardsFor(ev, s)} />
    </section>
  );
}
