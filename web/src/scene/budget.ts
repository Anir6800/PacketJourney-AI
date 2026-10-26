/** Back-to-back slow frames before glass, bloom and vignette degrade (about 1 s below 15 fps). */
export const BUDGET_MISSES = 12;

/** Frame-budget counter: frames over 50 ms count up, frames under 34 ms count down; gaps over 0.5 s (hidden tab, stalls between demand renders) are ignored. */
export const budgetStep = (misses: number, dt: number) => (dt > 0.05 && dt < 0.5 ? misses + 1 : dt < 0.034 ? Math.max(0, misses - 1) : misses);
