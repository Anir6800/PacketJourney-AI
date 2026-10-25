import { simulate, type SimConfig, type SimRun } from './simulate.ts';

/** Key-order-independent config equality. */
export function sameConfig(a: SimConfig, b: SimConfig): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => x.localeCompare(y)).map(([k, x]) => [k, norm(x)])) : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/**
 * Owns the active run. Starting or resetting bumps the generation; callbacks bound to an older
 * generation become no-ops, so nothing from a previous run can mutate the new one.
 */
export class RunController {
  private gen = 0;
  private current: (SimRun & { runId: number }) | null = null;

  start(cfg: SimConfig): SimRun & { runId: number } {
    const run = simulate(cfg);
    this.current = { ...run, runId: ++this.gen };
    return this.current;
  }

  reset(): void {
    this.gen++;
    this.current = null;
  }

  get active() {
    return this.current;
  }

  bind<A extends unknown[]>(runId: number, fn: (...a: A) => void): (...a: A) => void {
    return (...a) => {
      if (runId === this.gen) fn(...a);
    };
  }

  isDirty(draft: SimConfig): boolean {
    return !this.current || !sameConfig(draft, this.current.config);
  }
}
