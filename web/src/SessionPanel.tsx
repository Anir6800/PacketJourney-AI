import type { HttpSessionRun, SimRun } from '@packetjourney/shared';
import { Segmented } from './ui.tsx';

// HTTP session demo: reads only engine output (app write bytes and endpoint session state).

const decode = (b: readonly number[] | null | undefined) => new TextDecoder().decode(Uint8Array.from(b ?? []));
/** Make CR and LF visible so the CRLF separators are part of what is taught. */
const showCrlf = (s: string) => s.replace(/\r\n/g, '␍␊\n');

function messages(run: SimRun) {
  const req = run.events.find((e) => e.tag === 'app:send' && e.device === run.template.client);
  const res = run.events.find((e) => e.tag === 'app:respond');
  return { req: decode(req?.bytes), reqBytes: req?.bytes?.length ?? 0, res: decode(res?.bytes), resBytes: res?.bytes?.length ?? 0 };
}

export function SessionPanel({ ses, conn, onConn }: { ses: HttpSessionRun; conn: 'a' | 'b'; onConn: (c: 'a' | 'b') => void }) {
  const run = conn === 'a' ? ses.a : ses.b;
  const { client, server } = run.config.endpoints;
  const srv = run.timeline.final.endpoints[run.template.server]?.session;
  const cli = run.timeline.final.endpoints[run.template.client]?.session;
  const m = messages(run);
  const tuple = (r: SimRun) => `${r.config.endpoints.client.ip}:${r.config.endpoints.client.port} ↔ ${r.config.endpoints.server.ip}:${r.config.endpoints.server.port}`;

  return (
    <section className="session" aria-label="HTTP session demo" data-testid="session-panel">
      <div className="row">
        <Segmented
          label="Connection"
          value={conn}
          onChange={onConn}
          options={[
            { value: 'a', label: 'Connection A' },
            { value: 'b', label: 'Connection B' },
          ]}
        />
        <span className="badge badge-sim" title="Demo session values are educational, not credentials.">
          EDUCATIONAL SESSION
        </span>
      </div>
      <p className="small mono">
        A <span data-testid="tuple-a">{tuple(ses.a)}</span> · closed (FIN/ACK, TIME-WAIT) before B opens
        <br />B <span data-testid="tuple-b">{tuple(ses.b)}</span> · new handshake, new client port
      </p>
      <dl className="facts mono">
        <dt>Cookie sent</dt>
        <dd data-testid="cookie-sent">{srv?.cookieSent ?? 'none'}</dd>
        <dt>Server verdict</dt>
        <dd data-testid="session-verdict" data-verdict={srv?.verdict ?? ''}>
          {srv?.verdict ?? '—'}
        </dd>
        <dt>Set-Cookie issued</dt>
        <dd data-testid="session-issued">{srv?.issued ?? 'none'}</dd>
        <dt>Server session table</dt>
        <dd>{srv?.known.join(', ') || 'empty'}</dd>
        <dt>Client demo cookie jar</dt>
        <dd>{cli?.known.join(', ') || 'empty'}</dd>
      </dl>
      <div className="http-msgs">
        <figure>
          <figcaption className="hud-label">
            Request · {m.reqBytes} B · {client.ip}:{client.port} → :{server.port}
          </figcaption>
          <pre className="mono small" data-testid="http-request">
            {showCrlf(m.req)}
          </pre>
        </figure>
        <figure>
          <figcaption className="hud-label">Response · {m.resBytes} B</figcaption>
          <pre className="mono small" data-testid="http-response">
            {showCrlf(m.res)}
          </pre>
        </figure>
      </div>
      <p className="small muted">
        The session lives in the server app&apos;s memory and survives the close of TCP connection A. There is no session-layer header: the
        cookie is just HTTP header bytes, counted in TCP sequence numbers. HTTP here is unencrypted plain text; TLS is NOT BUILT. Demo ids are
        not authentication credentials, and no browser cookies are used.
      </p>
    </section>
  );
}
