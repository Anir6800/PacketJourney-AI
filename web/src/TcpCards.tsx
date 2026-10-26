import { TCP_STATES, TCP_TRANSITIONS, type SimRun, type SimState, type SimulationEvent } from '@packetjourney/shared';

const v = (n: number | null) => (n === null ? '—' : String(n));

/** TCP endpoint state cards + scoped state diagram, both read from the snapshot and the shared transition table. */
export function TcpCards({ run, s, ev }: { run: SimRun; s: SimState; ev: SimulationEvent | undefined }) {
  const { client, server } = run.config.endpoints;
  const tuple = `${client.ip}:${client.port} ↔ ${server.ip}:${run.config.requestDstPort}`;
  const lastTcp = ev?.transition?.machine === 'tcp' ? ev.transition : null;
  const eps = Object.values(s.endpoints);

  return (
    <section className="tcp" aria-label="TCP connection state" data-testid="tcp-cards">
      <p className="mono small">
        Four-tuple <span data-testid="four-tuple">{tuple}</span> · teaching ISNs, not secure random ISNs
      </p>
      <div className="tcp-cards">
        {eps.map((e) => (
          <div key={e.device} className="tcp-card" data-testid={`tcp-card-${e.device}`}>
            <div className="tcp-card-head">
              <strong>
                {e.device} · {e.role}
              </strong>
              <span className="tcp-state mono" data-testid={`tcp-state-${e.device}`}>
                {e.tcpState}
              </span>
            </div>
            <dl className="facts mono">
              <dt>ISS / IRS</dt>
              <dd>
                {v(e.iss)} / {v(e.irs)}
              </dd>
              <dt>SND.UNA</dt>
              <dd>{v(e.sndUna)}</dd>
              <dt>SND.NXT</dt>
              <dd data-testid={`snd-nxt-${e.device}`}>{v(e.sndNxt)}</dd>
              <dt>RCV.NXT</dt>
              <dd data-testid={`rcv-nxt-${e.device}`}>{v(e.rcvNxt)}</dd>
              <dt>Send buffer</dt>
              <dd>{e.sendBuffer.length} B unacked/queued</dd>
              {e.timers['time-wait'] && (
                <>
                  <dt>TIME-WAIT</dt>
                  <dd data-testid={`time-wait-${e.device}`}>
                    {e.timers['time-wait'].armed ? `armed until ${e.timers['time-wait'].deadlineMs} ms` : 'expired'} · educational, not an OS default
                  </dd>
                </>
              )}
            </dl>
          </div>
        ))}
      </div>
      <ol className="tcp-diagram mono" aria-label="TCP states (modelled subset; simultaneous close CLOSING NOT BUILT)">
        {TCP_STATES.map((st) => {
          const here = eps.filter((e) => e.tcpState === st).map((e) => e.device);
          return (
            <li key={st} data-active={here.length ? '' : undefined}>
              <span>{st}</span>
              {here.length > 0 && <span className="tcp-who">{here.join(' ')}</span>}
            </li>
          );
        })}
      </ol>
      <ul className="tcp-edges small mono">
        {TCP_TRANSITIONS.map((t) => {
          const hot = lastTcp && lastTcp.from === t.from && lastTcp.to === t.to;
          return (
            <li key={`${t.from}-${t.to}`} data-hot={hot ? '' : undefined}>
              {t.from} → {t.to} · {t.on} / send {t.send}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
