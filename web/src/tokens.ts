// Single source for design tokens. CSS reads them as custom properties (applyTokens),
// GSAP reads the same numbers directly, and contrast.test.ts measures the colours.

export const color = {
  bg0: '#05070D',
  bg1: '#0A1020',
  glass: 'rgba(16,24,44,0.55)',
  // Panels that sit over the 3D canvas use the scrim, so text stays AA even over a white pixel.
  scrim: 'rgba(8,12,26,0.86)',
  hairline: 'rgba(140,180,255,0.14)',
  text: '#E6EEFF',
  muted: '#8FA3C7',
  app: '#A78BFA',
  transport: '#38BDF8',
  internet: '#2DD4BF',
  link: '#FBBF24',
  physical: '#F472B6',
  success: '#34D399',
  danger: '#F87171',
} as const;

/** Seconds (GSAP units). */
export const dur = {
  micro: 0.16,
  tab: 0.24,
  panel: 0.28,
  stagger: 0.075,
  bootMax: 2.5,
} as const;

export const ease = {
  out: 'power3.out',
  inOut: 'expo.inOut',
} as const;

// CSS equivalents of the GSAP eases above.
const cssEase = {
  out: 'cubic-bezier(0.215, 0.61, 0.355, 1)',
  inOut: 'cubic-bezier(0.87, 0, 0.13, 1)',
} as const;

export function applyTokens(root: HTMLElement = document.documentElement): void {
  for (const [k, v] of Object.entries(color)) root.style.setProperty(`--c-${k}`, v);
  for (const [k, v] of Object.entries(dur)) root.style.setProperty(`--dur-${k}`, `${v * 1000}ms`);
  for (const [k, v] of Object.entries(cssEase)) root.style.setProperty(`--ease-${k}`, v);
}
