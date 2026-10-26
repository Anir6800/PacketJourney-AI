import { describe, expect, it } from 'vitest';
import { color as c } from './tokens.ts';
import { over, parse, ratio } from './contrast.ts';

// Informative text sits on these backings; the canvas worst case is a white 3D pixel.
const glass = over(c.bg1, c.glass);
const surfaces = {
  'bg1': over(c.bg1),
  'glass/bg1': glass,
  'glass/black canvas': over('#000000', c.glass),
  'glass/surface #111111': over('#111111', c.glass),
  'glass/surface #1A1A1A': over('#1A1A1A', c.glass),
  'primary button (white 16%)/glass': over('#000000', c.glass, 'rgba(255,255,255,0.16)'),
  'active seg (white 12%)/glass': over(c.bg1, c.glass, 'rgba(255,255,255,0.12)'),
  'scrim/white (3D canvas worst case)': over('#FFFFFF', c.scrim),
  'highlighted byte/scrim/white': over('#FFFFFF', c.scrim, 'rgba(10,10,10,0.6)', 'rgba(255,255,255,0.12)'),
} as const;
const texts = ['text', 'muted', 'app', 'transport', 'internet', 'link', 'physical', 'success', 'danger'] as const;

const rows = Object.entries(surfaces).flatMap(([bg, bgc]) =>
  texts.map((t) => ({ text: t, bg, ratio: Number(ratio(parse(c[t]), bgc).toFixed(2)) })),
);

describe('WCAG AA contrast (4.5:1 normal text)', () => {
  it('prints the measured table', () => {
    console.table(rows);
  });
  it.each(rows)('$text on $bg = $ratio', ({ ratio: r }) => {
    expect(r).toBeGreaterThanOrEqual(4.5);
  });
  it('inverted failure panel: black text on the white fill', () => {
    expect(ratio(parse(c.bg0), parse(c.danger))).toBeGreaterThanOrEqual(4.5);
  });
  it('reference: white on black is 21', () => {
    expect(ratio(parse('#FFFFFF'), parse('#000000'))).toBeCloseTo(21, 5);
  });
});
