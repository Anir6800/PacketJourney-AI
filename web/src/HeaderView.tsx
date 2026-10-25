import { hex, type Field, type HeaderKind, type SimState } from '@packetjourney/shared';
import { LayerGlyph } from './layers.tsx';

const GROUPS: { kind: HeaderKind[]; label: string }[] = [
  { kind: ['ethernet'], label: 'Ethernet II header' },
  { kind: ['ipv4'], label: 'IPv4 header' },
  { kind: ['tcp'], label: 'TCP header' },
  { kind: ['udp'], label: 'UDP header' },
  { kind: ['payload'], label: 'Application data' },
  { kind: ['padding', 'fcs'], label: 'Ethernet trailer' },
];

const STATUS_MARK = { calculated: '= calc', configured: '⚙ config', illustrative: '◌ illus.' } as const;

export function fieldAtByte(fields: readonly Field[], i: number): Field | undefined {
  return fields.find((f) => i >= f.byteStart && i < f.byteEnd);
}

/** Field list (frame order) + byte grid. Selecting a field highlights its exact byte range. */
export function HeaderView({ snap, selected, onSelect }: { snap: SimState; selected: string | null; onSelect: (id: string) => void }) {
  const frame = snap.units.link ?? [];
  const sel = snap.fields.find((f) => f.id === selected);
  const rows: number[][] = [];
  // 8 bytes per row: fits the narrowest (390 px) layout with offsets visible.
  for (let i = 0; i < frame.length; i += 8) rows.push(frame.slice(i, i + 8));

  return (
    <div className="headers">
      <div className="field-groups">
        {GROUPS.map((g) => {
          const fs = snap.fields.filter((f) => g.kind.includes(f.header)).sort((a, b) => a.bitOffset - b.bitOffset);
          if (!fs.length) return null;
          const layer = fs[0]?.layer ?? 'link';
          return (
            <section key={g.label} aria-label={g.label}>
              <h3 className="hud-label" style={{ color: `var(--c-${layer})` }}>
                <LayerGlyph layer={layer} size={12} /> {g.label}
              </h3>
              <ul className="field-list">
                {fs.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      className="field-btn"
                      data-testid={`field-${f.id}`}
                      aria-pressed={selected === f.id}
                      style={{ '--layer': `var(--c-${f.layer})` } as React.CSSProperties}
                      onClick={() => onSelect(f.id)}
                    >
                      <span className="fname">{f.name}</span>
                      <span className="fval mono">{f.display}</span>
                      <span className={`chip chip-${f.status} mono`}>{STATUS_MARK[f.status]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <figure className="bytegrid mono" aria-label={`Frame bytes: ${frame.length}, destination MAC through FCS`}>
        <figcaption className="hud-label">
          Frame bytes {frame.length} B · preamble/SFD and interframe gap are not part of the frame
          {sel && (
            <span className="unit" data-testid="hl-range">
              {' '}
              · {sel.name}: bytes {sel.byteStart}–{sel.byteEnd - 1}
              {sel.bitWidth % 8 || sel.bitOffset % 8 ? ` (bits ${sel.bitOffset}–${sel.bitOffset + sel.bitWidth - 1})` : ''}
            </span>
          )}
        </figcaption>
        <div aria-hidden="true">
          {rows.map((row, r) => (
            <div className="byterow" key={r}>
              <span className="byteoff">{String(r * 8).padStart(3, '0')}</span>
              {row.map((b, j) => {
                const i = r * 8 + j;
                const f = fieldAtByte(snap.fields, i);
                const hl = sel && i >= sel.byteStart && i < sel.byteEnd;
                return (
                  <span
                    key={i}
                    className="byte"
                    data-off={i}
                    data-hl={hl ? '' : undefined}
                    style={{ '--layer': `var(--c-${f?.layer ?? 'link'})` } as React.CSSProperties}
                    title={f ? `${i}: ${f.name}` : String(i)}
                    onClick={() => f && onSelect(f.id)}
                  >
                    {hex(b)}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </figure>
    </div>
  );
}

export function FieldDetail({ f }: { f: Field }) {
  return (
    <>
      <h2 className="layer-title" style={{ color: `var(--c-${f.layer})` }}>
        <LayerGlyph layer={f.layer} size={22} /> {f.name}
      </h2>
      <dl className="facts mono" data-testid="field-detail">
        <dt>Value</dt>
        <dd>{f.display}</dd>
        <dt>Bits</dt>
        <dd>
          offset {f.bitOffset}, width {f.bitWidth}
        </dd>
        <dt>Bytes</dt>
        <dd>
          {f.byteStart}–{f.byteEnd - 1}
        </dd>
        <dt>Status</dt>
        <dd>{f.status}</dd>
        <dt>Source</dt>
        <dd>{f.source}</dd>
        <dt>Order</dt>
        <dd>#{f.order} in assembly</dd>
      </dl>
      <p className="small explain">{f.explanation}</p>
    </>
  );
}
