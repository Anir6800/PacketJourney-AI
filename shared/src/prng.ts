/** mulberry32: tiny deterministic PRNG for seeded fixtures. Not cryptographic. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const u32 = (r: () => number) => Math.floor(r() * 2 ** 32);
export const u16 = (r: () => number) => Math.floor(r() * 2 ** 16);
