// Single source for design tokens. CSS reads them as custom properties (applyTokens),
// GSAP reads the same numbers directly, and contrast.test.ts measures the colours.

export const color = {
  bg0: '#000000',
  bg1: '#0A0A0A',
  glass: 'rgba(255,255,255,0.05)',
  // Panels that sit over the 3D canvas use the scrim, so text stays AA even over a white pixel.
  scrim: 'rgba(10,10,10,0.92)',
  hairline: 'rgba(255,255,255,0.12)',
  text: '#FAFAFA',
  muted: '#A3A3A3',
  app: '#FAFAFA',
  transport: '#D9D9D9',
  internet: '#BFBFBF',
  link: '#E5E5E5',
  physical: '#B5B5B5',
  success: '#FAFAFA',
  danger: '#FAFAFA',
} as const;

/** Seconds (GSAP units). */
export const dur = {
  micro: 0.16,
  tab: 0.24,
  panel: 0.24,
  stagger: 0.02,
  bootMax: 2.5,
} as const;

export const ease = {
  out: 'power4.out',
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
