// WCAG 2.x relative luminance and contrast ratio, with alpha compositing for glass/scrim layers.
type Rgba = [number, number, number, number];

export function parse(c: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(c);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(c);
  if (!m?.[1]) throw new Error(`bad colour ${c}`);
  const [r = 0, g = 0, b = 0, a = 1] = m[1].split(',').map(Number);
  return [r, g, b, a];
}

/** Composite colours bottom→top; returns an opaque colour. */
export function over(...layers: string[]): Rgba {
  let out: Rgba = [0, 0, 0, 1];
  for (const l of layers) {
    const [r, g, b, a] = parse(l);
    out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a), 1];
  }
  return out;
}

function luminance([r, g, b]: Rgba): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(fg: Rgba, bg: Rgba): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  return (a + 0.05) / (b + 0.05);
}
