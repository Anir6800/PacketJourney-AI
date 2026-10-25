import type { SimState } from '@packetjourney/shared';
import { HudLabel } from './ui.tsx';
import { fmtTime as ms } from './format.ts';

/** Read-only view of the reducer snapshot after one event. */
export function SnapshotDetail({ s, tag }: { s: SimState; tag: string }) {
  return (
    <div data-testid="snapshot-detail">
      <h2 className="layer-title">Snapshot after #{s.index}</h2>
      <p className="mono small">
        {tag} · t = {ms(s.timeMs)} (SIMULATED)
      </p>
      {Object.values(s.endpoints).map((e) => (
        <section key={e.device} aria-label={`Endpoint ${e.device}`}>
          <HudLabel>
            {e.device} · {e.role}
          </HudLabel>
          <dl className="facts mono">
            {e.sndNxt !== null && (
              <>
                <dt>TCP</dt>
                <dd>{e.tcpState}</dd>
              </>
            )}
            <dt>App</dt>
            <dd>{e.app}</dd>
            <dt>Send buf</dt>
            <dd>{e.sendBuffer.length} B unacked</dd>
            <dt>Delivered</dt>
            <dd>{e.deliveredBytes} B</dd>
            {e.rcvNxt !== null && (
              <>
                <dt>RCV.NXT</dt>
                <dd>{e.rcvNxt}</dd>
              </>
            )}
            {Object.entries(e.timers).map(([n, t]) => (
              <span key={n} style={{ display: 'contents' }}>
                <dt>{n}</dt>
                <dd>
                  gen {t.generation} · {t.armed ? `armed until ${ms(t.deadlineMs ?? 0)}` : 'idle'} · retries {t.retries}
                </dd>
              </span>
            ))}
          </dl>
        </section>
      ))}
      <HudLabel>Active hop</HudLabel>
      <p className="mono small">
        {s.activeHop
          ? `${s.activeHop.packetId} ${s.activeHop.from}→${s.activeHop.to} on ${s.activeHop.linkId}: send ${ms(s.activeHop.sendStartMs)}–${ms(s.activeHop.sendEndMs)}, arrives ${ms(s.activeHop.arrivalMs)}`
          : 'none'}
      </p>
      <HudLabel>Metrics</HudLabel>
      <dl className="facts mono">
        <dt>Frames</dt>
        <dd>{s.metrics.framesSent}</dd>
        <dt>Frame bytes</dt>
        <dd>{s.metrics.frameBytesSent} B</dd>
        <dt>Link occupancy</dt>
        <dd>{s.metrics.onLinkBytesSent} B-times</dd>
        <dt>Delivered</dt>
        <dd>{s.metrics.deliveredBytes} B</dd>
        <dt>Drops / retx</dt>
        <dd>
          {s.metrics.drops} / {s.metrics.retransmissions}
        </dd>
      </dl>
    </div>
  );
}
