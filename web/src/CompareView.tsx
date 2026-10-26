import { useMemo, useRef, useState } from 'react';
import { compareConfigs, explain, metricsOf, simulate, type Accounting, type CompareFault, type SimConfig, type SimRun } from '@packetjourney/shared';
import { gsap, useGSAP } from './gsap.ts';
import { Segmented } from './ui.tsx';
import { fmtTime } from './format.ts';

// TCP vs UDP on identical inputs. Each run keeps its OWN cursor: event numbers of the two runs are never aligned.

/** Counts up to the exact engine value; Reduced motion sets it at once. The final text is always the exact value. */
function CountUp({ value, format, reduced, testId }: { value: number | null; format: (v: number) => string; reduced: boolean; testId: string }) {
  const el = useRef<HTMLSpanElement>(null);
  const exact = value === null ? 'n/a' : format(value);
  useGSAP(
    () => {
      const node = el.current;
      if (!node) return;
      if (value === null || reduced || value === 0) {
        node.textContent = exact;
        return;
      }
      const o = { v: 0 };
      gsap.to(o, { v: value, duration: 0.6, ease: 'power3.out', onUpdate: () => (node.textContent = format(o.v)), onComplete: () => (node.textContent = exact) });
    },
    { dependencies: [value, reduced, exact] },
  );
  // No React text child: the effect owns the text (React would otherwise keep updating a detached text node).
  return <span ref={el} className="mono" data-testid={testId} data-exact={exact} />;
}

function MiniJourney({ run, label }: { run: SimRun; label: string }) {
  const [i, setI] = useState(run.events.length - 1);
  const ev = run.events[Math.min(i, run.events.length - 1)];
  const path = run.template.path;
  const W = 360;
  const x = (d: string) => 30 + (path.indexOf(d) * (W - 60)) / Math.max(1, path.length - 1);
  if (!ev) return null;
  const dropped = ev.type === 'drop';
  return (
    <section className="mini" aria-label={`${label} journey`} data-testid={`mini-${label}`}>
      <h4 className="hud-label">
        {label} · own cursor · event {i + 1} / {run.events.length}
      </h4>
      <svg viewBox={`0 0 ${W} 56`} className="mini-svg" aria-hidden="true">
        <line x1={30} y1={34} x2={W - 30} y2={34} stroke="var(--c-hairline)" strokeWidth={2} />
        {path.map((d) => (
          <g key={d}>
            <circle cx={x(d)} cy={34} r={9} fill="var(--c-scrim)" stroke={ev.device === d ? 'var(--c-transport)' : 'var(--c-hairline)'} strokeWidth={2} />
            <text x={x(d)} y={54} textAnchor="middle" className="svg-label">
              {d}
            </text>
          </g>
        ))}
        <text x={x(ev.device)} y={16} textAnchor="middle" className={dropped ? 'svg-notice svg-notice-danger' : 'svg-label'}>
          {dropped ? '✕ dropped' : ev.tag}
        </text>
      </svg>
      <div className="row">
        <div className="seg" role="group" aria-label={`${label} cursor`}>
          <button type="button" aria-label={`${label}: first event`} onClick={() => setI(0)}>⏮</button>
          <button type="button" aria-label={`${label}: previous event`} onClick={() => setI((v) => Math.max(0, v - 1))}>◀</button>
          <button type="button" aria-label={`${label}: next event`} onClick={() => setI((v) => Math.min(run.events.length - 1, v + 1))}>▶</button>
          <button type="button" aria-label={`${label}: last event`} onClick={() => setI(run.events.length - 1)}>⏭</button>
        </div>
        <span className="mono small muted">t = {fmtTime(ev.virtualTimeMs)}</span>
      </div>
      <p className="small" data-testid={`mini-caption-${label}`}>
        <span className="ev-tag mono">{ev.tag}</span> {explain(ev)}
      </p>
    </section>
  );
}

const ROWS: { key: keyof ReturnType<typeof metricsOf>; label: string; unit: string; fmt: (v: number) => string }[] = [
  { key: 'uniqueAppBytes', label: 'Unique application bytes delivered', unit: 'bytes delivered to apps; a duplicate never counts twice', fmt: (v) => `${Math.round(v)} B` },
  { key: 'retransmissions', label: 'Transport retransmissions', unit: 'TCP timer-driven resends (UDP never resends)', fmt: (v) => String(Math.round(v)) },
  { key: 'frameBytes', label: 'Frame bytes transmitted', unit: 'Ethernet frames dst MAC … FCS incl. headers and padding, every link; preamble/SFD/IFG excluded', fmt: (v) => `${Math.round(v)} B` },
  { key: 'droppedFrames', label: 'Dropped frames', unit: 'frames the engine discarded (fault, FCS, checksum, TTL)', fmt: (v) => String(Math.round(v)) },
  { key: 'firstDeliveryMs', label: 'First delivery', unit: 'virtual ms to the first app delivery (SIMULATED); n/a if none', fmt: (v) => `${v.toFixed(3)} ms` },
  { key: 'completionMs', label: 'Completion', unit: 'delivery: last app delivery; full: last event of the exchange (SIMULATED)', fmt: (v) => `${v.toFixed(3)} ms` },
  { key: 'goodputBps', label: 'Goodput', unit: 'unique app bits ÷ completion time (simulated seconds); n/a for zero or no duration', fmt: (v) => `${(v / 1000).toFixed(1)} kb/s` },
  { key: 'overheadRatio', label: 'Overhead ratio', unit: '(frame bytes − unique app bytes) ÷ frame bytes counted', fmt: (v) => `${(v * 100).toFixed(1)} %` },
];

export function CompareView({ base, reduced }: { base: SimConfig; reduced: boolean }) {
  const [fault, setFault] = useState<CompareFault>('none');
  const [accounting, setAccounting] = useState<Accounting>('full');
  const runs = useMemo(() => {
    const c = compareConfigs(base, fault, 0);
    return { tcp: simulate(c.tcp), udp: simulate(c.udp) };
  }, [base, fault]);
  const m = { TCP: metricsOf(runs.tcp, accounting), UDP: metricsOf(runs.udp, accounting) };

  return (
    <section className="compare" aria-label="Compare TCP and UDP" data-testid="compare">
      <p className="small muted">
        Same application bytes ("{base.request}"), path ({base.template}), links and fault; raw echo, close disabled. Included: TCP = handshake, data, ACKs (no close); UDP = the
        datagram exchange. The fault hits the first data transmission in both (matched by packet, not event number). SIMULATED values; no winner is declared.
      </p>
      <div className="row">
        <Segmented label="Compare fault" value={fault} onChange={setFault} options={[
          { value: 'none', label: 'No fault' },
          { value: 'drop', label: 'Drop first data' },
          { value: 'delay', label: 'Delay first data 5 ms' },
          { value: 'corrupt', label: 'Corrupt first data (FCS)' },
        ]} />
        <Segmented label="Accounting" value={accounting} onChange={setAccounting} options={[
          { value: 'full', label: 'Full exchange' },
          { value: 'delivery', label: 'Delivery only' },
        ]} />
      </div>
      <div className="compare-journeys">
        <MiniJourney key={`tcp-${fault}`} run={runs.tcp} label="TCP" />
        <MiniJourney key={`udp-${fault}`} run={runs.udp} label="UDP" />
      </div>
      <table className="metrics mono small" data-testid="metrics">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            <th scope="col">TCP</th>
            <th scope="col">UDP</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                {r.label}
                <span className="muted unit-def">{r.unit}</span>
              </th>
              {(['TCP', 'UDP'] as const).map((p) => (
                <td key={p}>
                  <CountUp value={m[p][r.key]} format={r.fmt} reduced={reduced} testId={`m-${p}-${r.key}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">
        {accounting === 'full' ? 'Full exchange counts every frame, including handshake and pure ACKs.' : 'Delivery only counts frames that carry application data (and their retransmissions).'} 3D side-by-side:
        NOT BUILT (not measured within the performance budget).
      </p>
    </section>
  );
}
