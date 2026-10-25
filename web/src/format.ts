/** Virtual (SIMULATED) time label: µs below 1 ms. */
export const fmtTime = (ms: number) => (ms < 1 ? `${(ms * 1000).toFixed(2)} µs` : `${ms.toFixed(3)} ms`);
