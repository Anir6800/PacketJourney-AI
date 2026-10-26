import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFERENCES, PREFS_KEY, PRACTICE_KEY, SCENARIO_KEY, clearLocalDemoData, loadPreferences, readStoredScenario, savePreferences, saveStoredScenario } from './settings.ts';

class MemoryStore {
  data = new Map<string, string>();
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
}

describe('guarded local settings', () => {
  it('persists only preferences, scenario and progress keys, then clears them', () => {
    const s = new MemoryStore();
    expect(savePreferences({ ...DEFAULT_PREFERENCES, motion: 'reduced', view: '2d' }, s)).toBe(true);
    expect(saveStoredScenario('{"safe":true}', s)).toBe(true);
    s.setItem(PRACTICE_KEY, '{}');
    expect([...s.data.keys()].sort()).toEqual([PRACTICE_KEY, PREFS_KEY, SCENARIO_KEY].sort());
    expect(loadPreferences(s).value).toMatchObject({ motion: 'reduced', view: '2d', theme: 'dark' });
    expect(readStoredScenario(s).text).toBe('{"safe":true}');
    expect(clearLocalDemoData(s)).toBe(true);
    expect(s.data.size).toBe(0);
  });

  it('recovers corrupt data and tolerates unavailable storage', () => {
    const corrupt = new MemoryStore();
    corrupt.setItem(PREFS_KEY, '{bad');
    expect(loadPreferences(corrupt)).toEqual({ value: DEFAULT_PREFERENCES, state: 'recovered' });
    expect(corrupt.getItem(PREFS_KEY)).toBeNull();

    const wrong = new MemoryStore();
    wrong.setItem(PREFS_KEY, '{"motion":"warp"}');
    expect(loadPreferences(wrong).state).toBe('recovered');
    expect(wrong.getItem(PREFS_KEY)).toBeNull();

    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(loadPreferences(blocked).state).toBe('unavailable');
    expect(saveStoredScenario('{}', blocked)).toBe(false);
    expect(clearLocalDemoData(blocked)).toBe(false);
  });
});
