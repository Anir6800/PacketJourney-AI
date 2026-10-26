import { useState } from 'react';
import { FAULT_PACKETS, TEMPLATES, type Fault, type PacketKind, type SimConfig } from '@packetjourney/shared';

type Preset = 'drop' | 'lose-ack' | 'delay' | 'corrupt-wire' | 'corrupt-transport';
const PRESET_LABEL: Record<Preset, string> = {
  drop: 'Drop a frame',
  'lose-ack': 'Lose a TCP ACK',
  delay: 'Delay a frame',
  'corrupt-wire': 'Corrupt one wire bit (fails FCS)',
  'corrupt-transport': 'Corrupt a transport byte, recompute FCS (advanced)',
};

function describe(f: Fault): string {
  if (f.kind === 'loss') return `lose ${f.packet} ×${f.count} on the sender's link (Story preset)`;
  const t = `${f.target.packet} · attempt ${f.target.attempt} · hop ${f.target.hop}`;
  if (f.kind === 'drop') return `drop ${t}`;
  if (f.kind === 'delay') return `delay ${t} by ${f.delayMs} ms`;
  return `corrupt (${f.mode}) ${t} · segment byte ${f.offset} bit ${f.bit}`;
}

/** Lab fault editor: targeted one-shot faults after establishment. Validation lives in the shared validator. */
export function FaultEditor({ draft, setDraft, issues }: { draft: SimConfig; setDraft: (f: (d: SimConfig) => SimConfig) => void; issues: { field: string; message: string }[] }) {
  const tcp = draft.protocol === 'TCP';
  const presets = (Object.keys(PRESET_LABEL) as Preset[]).filter((p) => tcp || p !== 'lose-ack');
  const [preset, setPreset] = useState<Preset>('drop');
  const kinds: readonly PacketKind[] = FAULT_PACKETS[draft.protocol];
  const [packet, setPacket] = useState<PacketKind>('data');
  const [attempt, setAttempt] = useState(0);
  const [hop, setHop] = useState(0);
  const [delayMs, setDelayMs] = useState(5);
  const [offset, setOffset] = useState(tcp ? 20 : 8);
  const [bit, setBit] = useState(0);
  const path = TEMPLATES[draft.template].path;
  const hops = path.slice(0, -1).map((d, i) => `hop ${i}: ${d} → ${path[i + 1]}`);
  const pk: PacketKind = preset === 'lose-ack' ? 'ack' : kinds.includes(packet) ? packet : 'data';

  const add = () => {
    const target = { packet: pk, attempt, hop: Math.min(hop, hops.length - 1) };
    const f: Fault =
      preset === 'delay' ? { kind: 'delay', target, delayMs }
        : preset === 'corrupt-wire' ? { kind: 'corrupt', target, mode: 'wire', offset, bit }
          : preset === 'corrupt-transport' ? { kind: 'corrupt', target, mode: 'transport', offset, bit }
            : { kind: 'drop', target };
    setDraft((d) => ({ ...d, faults: [...d.faults, f] }));
  };
  const num = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));

  return (
    <section className="fault-editor" aria-label="Fault lab" data-testid="fault-editor">
      <p className="small muted">
        One-shot faults (SIMULATED), targeted by packet, attempt and hop; only after the connection is established. Receivers check in order: Ethernet FCS →
        IPv4 header checksum → transport checksum → port. A frame that fails the FCS is discarded by the NIC; nothing above it runs.
      </p>
      <ul className="fault-list mono small" data-testid="fault-list">
        {draft.faults.map((f, i) => (
          <li key={i}>
            {describe(f)}{' '}
            <button type="button" className="btn btn-icon" aria-label={`Remove fault ${i + 1}`} onClick={() => setDraft((d) => ({ ...d, faults: d.faults.filter((_, j) => j !== i) }))}>
              ✕
            </button>
            {issues.find((x) => x.field === `faults.${i}`) && (
              <span className="field-error" role="alert">
                {' '}
                ✕ {issues.find((x) => x.field === `faults.${i}`)?.message}
              </span>
            )}
          </li>
        ))}
        {!draft.faults.length && <li className="muted">No faults.</li>}
      </ul>
      <label htmlFor="fault-preset">Fault</label>
      <select id="fault-preset" className="field" value={preset} onChange={(e) => setPreset(e.target.value as Preset)}>
        {presets.map((p) => (
          <option key={p} value={p}>
            {PRESET_LABEL[p]}
          </option>
        ))}
      </select>
      {preset !== 'lose-ack' && (
        <>
          <label htmlFor="fault-packet">Packet</label>
          <select id="fault-packet" className="field" value={pk} onChange={(e) => setPacket(e.target.value as PacketKind)}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor="fault-hop">Hop</label>
      <select id="fault-hop" className="field" value={Math.min(hop, hops.length - 1)} onChange={(e) => setHop(Number(e.target.value))}>
        {hops.map((h, i) => (
          <option key={h} value={i}>
            {h} (reverse for replies)
          </option>
        ))}
      </select>
      <label htmlFor="fault-attempt">Attempt (0 = original)</label>
      <input id="fault-attempt" className="field mono" inputMode="numeric" value={Number.isNaN(attempt) ? '' : attempt} onChange={(e) => setAttempt(num(e.target.value))} />
      {preset === 'delay' && (
        <>
          <label htmlFor="fault-delay">Delay (ms, SIMULATED)</label>
          <input id="fault-delay" className="field mono" inputMode="decimal" value={Number.isNaN(delayMs) ? '' : delayMs} onChange={(e) => setDelayMs(num(e.target.value))} />
        </>
      )}
      {preset.startsWith('corrupt') && (
        <>
          <label htmlFor="fault-offset">Transport segment byte (0 = first header byte)</label>
          <input id="fault-offset" className="field mono" inputMode="numeric" value={Number.isNaN(offset) ? '' : offset} onChange={(e) => setOffset(num(e.target.value))} />
          <label htmlFor="fault-bit">Bit (0–7)</label>
          <input id="fault-bit" className="field mono" inputMode="numeric" value={Number.isNaN(bit) ? '' : bit} onChange={(e) => setBit(num(e.target.value))} />
        </>
      )}
      <button type="button" className="btn" onClick={add} data-testid="fault-add">
        Add fault
      </button>
      <p className="small muted">
        TCP retries use a simplified policy (fixed initial RTO {draft.rtoMs} ms, ×2 per retry, at most {draft.maxRetries} retries; not RFC 6298). UDP never retries. Zero-window
        and congestion control: NOT BUILT.
      </p>
    </section>
  );
}
