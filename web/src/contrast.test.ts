import { describe, expect, it } from 'vitest';
import { color as c } from './tokens.ts';
import { over, parse, ratio } from './contrast.ts';

// Backgrounds text actually sits on. bg1 is the lighter end of the gradient (worst case for light text);
// "canvas worst case" assumes a pure white 3D pixel behind the scrim.
const glass = over(c.bg1, c.glass);
const surfaces = {
  'bg1': over(c.bg1),
  'glass/bg1': glass,
  'active seg (transport 16%)/glass': over(c.bg1, c.glass, 'rgba(56,189,248,0.16)'),
  'scrim/white (3D canvas worst case)': over('#FFFFFF', c.scrim),
  'highlighted byte/scrim/white': over('#FFFFFF', c.scrim, 'rgba(5,7,13,0.6)', 'rgba(140,180,255,0.12)'),
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
  it('reference: white on black is 21', () => {
    expect(ratio(parse('#FFFFFF'), parse('#000000'))).toBeCloseTo(21, 5);
  });
});
