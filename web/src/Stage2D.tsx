import { LAYERS, LAYER_LINE } from './layers.tsx';
import type { ScenePacket, ShellLayer } from './scene/model.ts';

const R: Record<ShellLayer, number> = { app: 12, transport: 24, internet: 36, link: 48 };

// 2D SVG equivalent of the 3D capsule, drawn from the same pure scene model: nested shells with the
// line-style layer encoding. Used when WebGL is unavailable, lost, or View = 2D.
export function Stage2D({ reason, packet }: { reason: string; packet?: ScenePacket | null }) {
  const shells = packet?.shells ?? [];
  return (
    <figure className="stage-2d" data-testid="stage-2d">
      <svg viewBox="0 0 320 140" aria-hidden="true" data-testid="stage-2d-shells">
        <g transform="translate(90 70)">
          {packet?.bitStream && <circle r={60} fill="none" strokeWidth={3} {...LAYER_LINE.physical} />}
          {[...shells].reverse().map((s) => (
            <g key={s.layer} data-layer={s.layer}>
              <circle r={R[s.layer]} strokeWidth={s.layer === 'app' ? 0 : 1.5} {...LAYER_LINE[s.layer]} />
              {s.layer === 'link' && <circle r={R.link - 4} fill="none" stroke="var(--c-text)" strokeWidth={1.5} />}
            </g>
          ))}
          {packet?.dropped && <line x1={-66} y1={0} x2={66} y2={0} stroke="var(--c-text)" strokeWidth={3} />}
        </g>
        {shells.map((s, i) => (
          <text key={s.layer} x={170} y={36 + i * 20} className="stage-2d-label">
            {LAYERS[s.layer].code} · {LAYERS[s.layer].name}
          </text>
        ))}
        {packet?.bitStream && <text x={170} y={36 + shells.length * 20} className="stage-2d-label">PHY · bits on the wire</text>}
      </svg>
      <figcaption className="hud-label">2D view · {reason}</figcaption>
    </figure>
  );
}
