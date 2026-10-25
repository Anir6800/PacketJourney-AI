import { explain, hex, type SimulationEvent } from '@packetjourney/shared';
import { fmtTime } from './format.ts';

/** Event log: virtual timestamps, tag, explanation; each row expands into its field details. */
export function EventLog({ events, selected, onSelect }: { events: readonly SimulationEvent[]; selected: number | null; onSelect: (i: number) => void }) {
  return (
    <section aria-label="Event log">
      <h3 className="hud-label">
        Event log · {events.length} events · virtual time <span className="unit">SIMULATED</span>
      </h3>
      <ol className="events mono" data-testid="events">
        {events.map((e) => (
          <li key={e.id}>
            <details className="event" data-selected={selected === e.index ? '' : undefined} style={{ '--layer': `var(--c-${e.layer})` } as React.CSSProperties}>
              <summary onClick={() => onSelect(e.index)}>
                <span className="ev-time">{fmtTime(e.virtualTimeMs)}</span>
                <span className="ev-tag">{e.tag}</span>
                <span className="ev-text">{explain(e)}</span>
              </summary>
              <dl className="ev-details" data-testid="ev-details">
                <dt>Event</dt>
                <dd>
                  {e.id} · {e.device}
                  {e.iface ? `.${e.iface}` : ''} · {e.direction} · {e.layer}
                  {e.causeId ? ` · caused by ${e.causeId}` : ''}
                </dd>
                {Object.entries(e.explainArgs).map(([k, v]) => (
                  <span key={k} style={{ display: 'contents' }}>
                    <dt>{k}</dt>
                    <dd>{String(v)}</dd>
                  </span>
                ))}
                {e.transition && (
                  <>
                    <dt>Transition</dt>
                    <dd>
                      {e.transition.machine}: {e.transition.from} → {e.transition.to}
                    </dd>
                  </>
                )}
                {e.timing && (
                  <>
                    <dt>Send start / end</dt>
                    <dd>
                      {fmtTime(e.timing.sendStartMs)} / {fmtTime(e.timing.sendEndMs)}
                    </dd>
                    <dt>Arrival</dt>
                    <dd>{fmtTime(e.timing.arrivalMs)}</dd>
                    <dt>Frame / on-link</dt>
                    <dd>
                      {e.timing.frameBytes} B / {e.timing.onLinkBytes} B ({e.timing.bits} bits at {e.timing.bps / 1e6} Mb/s)
                    </dd>
                  </>
                )}
                {e.bytes && (
                  <>
                    <dt>Bytes ({e.bytes.length})</dt>
                    <dd className="ev-bytes">
                      {e.bytes.slice(0, 64).map((b) => hex(b)).join(' ')}
                      {e.bytes.length > 64 ? ` … +${e.bytes.length - 64}` : ''}
                    </dd>
                  </>
                )}
              </dl>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}
