import { describe, expect, it } from 'vitest';
import { BUDGET_MISSES, budgetStep } from './budget.ts';

const run = (dts: number[]) => dts.reduce(budgetStep, 0);

describe('frame budget fallback rule', () => {
  it('degrades after sustained slow frames', () => {
    expect(run(Array(BUDGET_MISSES + 1).fill(0.08))).toBeGreaterThan(BUDGET_MISSES);
  });
  it('recovers its margin on fast frames and ignores long gaps', () => {
    expect(run([...Array(10).fill(0.08), ...Array(10).fill(0.016)])).toBe(0);
    expect(run(Array(40).fill(0.9))).toBe(0);
  });
});
