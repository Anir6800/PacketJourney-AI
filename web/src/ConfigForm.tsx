import type { ReactNode } from 'react';
import { PAYLOAD_MAX, checkPayload, templateEndpoints, type ConfigIssue, type CookieChoice, type SimConfig, type TemplateId } from '@packetjourney/shared';

type Props = {
  draft: SimConfig;
  setDraft: (f: (d: SimConfig) => SimConfig) => void;
  issues: ConfigIssue[];
  dirty: boolean;
  onRun: () => void;
  onReset: () => void;
  runInfo: string;
  cookieB: CookieChoice;
  setCookieB: (c: CookieChoice) => void;
};

function Input(p: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  hint?: ReactNode;
  disabled?: boolean;
  numeric?: boolean;
}) {
  const describedBy = [p.hint ? `${p.id}-hint` : '', p.error ? `${p.id}-err` : ''].filter(Boolean).join(' ') || undefined;
  return (
    <>
      <label htmlFor={p.id}>{p.label}</label>
      <input
        id={p.id}
        className="field mono"
        value={p.value}
        disabled={p.disabled}
        inputMode={p.numeric ? 'numeric' : undefined}
        aria-invalid={Boolean(p.error)}
        aria-describedby={describedBy}
        onChange={(e) => p.onChange(e.target.value)}
      />
      {p.hint && (
        <p id={`${p.id}-hint`} className="small muted">
          {p.hint}
        </p>
      )}
      {p.error && (
        <p id={`${p.id}-err`} className="field-error" role="alert">
          ✕ {p.error}
        </p>
      )}
    </>
  );
}

const portText = (p: number) => (Number.isNaN(p) ? '' : String(p));
/** Digits-only numeric input; empty → NaN so validation reports it. Used for ports and ISNs. */
const toPort = (v: string) => (v.replace(/\D/g, '') === '' ? Number.NaN : Number(v.replace(/\D/g, '')));

export function ConfigForm({ draft, setDraft, issues, dirty, onRun, onReset, runInfo, cookieB, setCookieB }: Props) {
  const err = (f: string) => issues.find((i) => i.field === f)?.message;
  const check = checkPayload(draft.request);
  const routed = draft.template === 'routed';
  const http = draft.payloadMode === 'http';
  const tcp = draft.protocol === 'TCP';
  const setEp = (side: 'client' | 'server', k: 'ip' | 'mac' | 'port', v: string | number) =>
    setDraft((d) => ({ ...d, endpoints: { ...d.endpoints, [side]: { ...d.endpoints[side], [k]: v } } }));

  return (
    <form
      className="form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        onRun();
      }}
    >
      <label htmlFor="payload-mode">Payload</label>
      <select
        id="payload-mode"
        className="field"
        value={draft.payloadMode}
        aria-describedby="payload-mode-hint"
        onChange={(e) => setDraft((d) => ({ ...d, payloadMode: e.target.value === 'http' ? 'http' : 'raw' }))}
      >
        <option value="raw">Raw text</option>
        <option value="http" disabled={!tcp}>
          HTTP/1.1 session demo{tcp ? '' : ' · TCP only'}
        </option>
      </select>
      <p id="payload-mode-hint" className="small muted" data-testid="payload-mode-hint">
        {tcp
          ? 'HTTP mode runs two TCP connections (A, then B on another client port) and shows a demo session cookie surviving the close of A.'
          : 'HTTP/session mode is disabled for UDP: HTTP/1.1 needs a reliable, ordered byte stream. UDP supports raw echo only.'}
      </p>
      {err('payloadMode') && (
        <p className="field-error" role="alert">
          ✕ {err('payloadMode')}
        </p>
      )}
      {http ? (
        <>
          <label htmlFor="cookie-b">Connection B sends</label>
          <select id="cookie-b" className="field" value={cookieB} onChange={(e) => setCookieB(e.target.value as CookieChoice)}>
            <option value="valid">The cookie issued on A</option>
            <option value="missing">No cookie</option>
            <option value="invalid">An invalid demo id</option>
          </select>
          <p className="small muted">Requests and responses are generated HTTP/1.1 text (CRLF line ends, Content-Length in bytes). Demo session ids are EDUCATIONAL, not credentials; HTTP is unencrypted; TLS NOT BUILT.</p>
        </>
      ) : (
        <>
          <Input id="msg" label="Message" value={draft.request} onChange={(v) => setDraft((d) => ({ ...d, request: v }))} error={err('request')} />
          <p className={`small mono ${check.ok || (tcp && draft.close.enabled && draft.request === '') ? 'muted' : 'field-error'}`} data-testid="byte-count">
            {check.ok ? check.bytes.length : check.byteLength} / {PAYLOAD_MAX} bytes · {[...draft.request].length} characters
            {tcp && draft.close.enabled && draft.request === '' ? ' · orderly no-data close' : ''}
          </p>
        </>
      )}

      <label htmlFor="scope">Destination</label>
      <select
        id="scope"
        className="field"
        value={draft.template}
        onChange={(e) => {
          const t = e.target.value as TemplateId;
          setDraft((d) => ({ ...d, template: t, endpoints: templateEndpoints(t, { client: d.endpoints.client.port, server: d.endpoints.server.port }) }));
        }}
      >
        <option value="same-lan">Same LAN</option>
        <option value="routed">Routed via R1</option>
        <option value="loopback" disabled>
          Loopback · NOT BUILT
        </option>
      </select>

      <fieldset className="endpoint">
        <legend>Client A · client app</legend>
        <Input id="client-ip" label="IPv4 address" value={draft.endpoints.client.ip} disabled={routed} onChange={(v) => setEp('client', 'ip', v)} error={err('client.ip')} />
        <Input id="client-mac" label="MAC address" value={draft.endpoints.client.mac} disabled={routed} onChange={(v) => setEp('client', 'mac', v)} error={err('client.mac')} />
        <Input id="client-port" label="Source port" numeric value={portText(draft.endpoints.client.port)} onChange={(v) => setEp('client', 'port', toPort(v))} error={err('client.port')} />
      </fieldset>

      <fieldset className="endpoint">
        <legend>Server B · echo app</legend>
        <Input id="server-ip" label="IPv4 address" value={draft.endpoints.server.ip} disabled={routed} onChange={(v) => setEp('server', 'ip', v)} error={err('server.ip')} />
        <Input id="server-mac" label="MAC address" value={draft.endpoints.server.mac} disabled={routed} onChange={(v) => setEp('server', 'mac', v)} error={err('server.mac')} />
        <Input id="server-port" label="Echo app listens on port" numeric value={portText(draft.endpoints.server.port)} onChange={(v) => setEp('server', 'port', toPort(v))} error={err('server.port')} />
      </fieldset>
      {routed && (
        <p className="small muted">
          Routed template (Sender → R1 → R2 → Receiver): addresses, route tables and ARP caches are a fixed fixture (RFC 5737 blocks); ports and TTL stay editable.
        </p>
      )}
      <Input
        id="ttl"
        label="Initial TTL"
        numeric
        value={Number.isNaN(draft.ttl) ? '' : String(draft.ttl)}
        onChange={(v) => setDraft((d) => ({ ...d, ttl: toPort(v) }))}
        error={err('ttl')}
        hint="Each router decrements TTL and drops the packet instead of sending it with TTL 0. The receiving host does not decrement."
      />

      <Input
        id="dst-port"
        label="Send to destination port"
        numeric
        value={portText(draft.requestDstPort)}
        onChange={(v) => setDraft((d) => ({ ...d, requestDstPort: toPort(v) }))}
        error={err('requestDstPort')}
        hint="Only an application bound to this port receives the message. A different port reaches no app."
      />

      {!http && (
      <>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.reply.enabled}
          onChange={(e) => setDraft((d) => ({ ...d, reply: { ...d.reply, enabled: e.target.checked } }))}
        />{' '}
        Echo app replies (custom behaviour, not HTTP)
      </label>
      <Input
        id="reply-text"
        label="Reply text"
        value={draft.reply.text}
        disabled={!draft.reply.enabled}
        onChange={(v) => setDraft((d) => ({ ...d, reply: { ...d.reply, text: v } }))}
        error={err('reply.text')}
      />
      </>
      )}

      {tcp && (
        <fieldset className="endpoint">
          <legend>TCP close</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={http || draft.close.enabled}
              disabled={http}
              onChange={(e) => setDraft((d) => ({ ...d, close: { ...d.close, enabled: e.target.checked } }))}
            />{' '}
            Close the connection after the exchange{http ? ' (always on in HTTP mode)' : ''}
          </label>
          <Input
            id="time-wait"
            label="TIME-WAIT (ms, educational)"
            numeric
            disabled={!(http || draft.close.enabled)}
            value={Number.isNaN(draft.close.timeWaitMs) ? '' : String(draft.close.timeWaitMs)}
            onChange={(v) => setDraft((d) => ({ ...d, close: { ...d.close, timeWaitMs: toPort(v) } }))}
            error={err('close.timeWaitMs')}
            hint="Client FIN → server ACK → server FIN → client ACK; each FIN consumes one sequence number. This timer is an EDUCATIONAL value, not an OS default (real 2×MSL is minutes). Leave the message empty for a no-data close."
          />
        </fieldset>
      )}
      {draft.protocol === 'TCP' && (
        <fieldset className="endpoint">
          <legend>TCP teaching ISNs</legend>
          <Input
            id="isn-client"
            label="Client ISN"
            numeric
            value={Number.isNaN(draft.tcp.isnClient) ? '' : String(draft.tcp.isnClient)}
            onChange={(v) => setDraft((d) => ({ ...d, tcp: { ...d.tcp, isnClient: toPort(v) } }))}
            error={err('tcp.isnClient')}
          />
          <Input
            id="isn-server"
            label="Server ISN"
            numeric
            value={Number.isNaN(draft.tcp.isnServer) ? '' : String(draft.tcp.isnServer)}
            onChange={(v) => setDraft((d) => ({ ...d, tcp: { ...d.tcp, isnServer: toPort(v) } }))}
            error={err('tcp.isnServer')}
            hint="Fixed, readable values for teaching. Real stacks pick unpredictable ISNs (RFC 9293 §3.4.1, RFC 6528). No delayed ACK, no Nagle, no options."
          />
        </fieldset>
      )}
      {draft.protocol === 'UDP' && (
        <>
          <label className="check">
            <input type="checkbox" checked={draft.udpChecksum} onChange={(e) => setDraft((d) => ({ ...d, udpChecksum: e.target.checked }))} /> UDP checksum enabled
          </label>
          <p className="small muted" data-testid="udp-checksum-note">
            Over IPv4 a UDP checksum of 0 means "not supplied" and receivers skip the check (RFC 768). IPv6 makes it mandatory (RFC 8200). Default: on.
          </p>
        </>
      )}

      <details className="small muted restrictions">
        <summary>Demo restrictions</summary>
        <p>
          Hosts must be unicast addresses in one /24 (.1–.254), with unicast MACs and ports 1–65535, and client and server must differ. The header fields could
          hold more (for example port 0 or any IPv4 address); the demo narrows them so every run is a valid same-link exchange.
        </p>
      </details>

      {issues.length > 0 && (
        <p className="field-error small" data-testid="blocked">
          Run blocked: fix {issues.length} field{issues.length > 1 ? 's' : ''} above.
        </p>
      )}
      {dirty && (
        <p className="dirty small" role="status" data-testid="dirty">
          ◆ Draft differs from the running config. Run to apply, or reset.
        </p>
      )}
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={issues.length > 0}>
          {dirty ? 'Run new simulation' : 'Run again'}
        </button>
        <button type="button" className="btn" disabled={!dirty} onClick={onReset}>
          Reset
        </button>
      </div>
      <p className="small muted mono" data-testid="run-info">
        {runInfo}
      </p>
    </form>
  );
}
