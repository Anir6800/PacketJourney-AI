// 2D SVG backdrop used when WebGL is unavailable, lost, or View = 2D.
// Must show the same steps as the 3D stage once the journey exists; for now both sit behind the layer-stack preview.
export function Stage2D({ reason }: { reason: string }) {
  return (
    <figure className="stage-2d" data-testid="stage-2d">
      <svg viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <polygon points="100,20 140,42 140,86 100,108 60,86 60,42" fill="none" stroke="var(--c-transport)" strokeOpacity="0.35" strokeWidth="1.5" />
      </svg>
      <figcaption className="hud-label">2D view · {reason}</figcaption>
    </figure>
  );
}
