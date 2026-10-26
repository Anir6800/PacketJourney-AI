import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESETS, presetById } from './presets.ts';
import { createScenarioFile, MAX_SCENARIO_BYTES, parseScenarioJson, scenarioJson } from './scenario.ts';
import { sameConfig } from './sim/run.ts';
import { simulate, type SimConfig } from './sim/simulate.ts';
import { simulateHttpSession } from './sim/session.ts';

describe('versioned scenario files and presets', () => {
  const errorOf = (result: ReturnType<typeof parseScenarioJson>) => result.ok ? '' : result.error;
  it('round-trips every preset and regenerates identical events', () => {
    for (const preset of PRESETS) {
      const parsed = parseScenarioJson(scenarioJson(preset.name, structuredClone(preset.config), preset.cookieB));
      expect(parsed.ok, preset.id).toBe(true);
      if (!parsed.ok) continue;
      expect(sameConfig(parsed.value.config, preset.config)).toBe(true);
      if (preset.config.payloadMode === 'http') {
        const before = simulateHttpSession(structuredClone(preset.config), preset.cookieB);
        const after = simulateHttpSession(parsed.value.config, parsed.value.cookieB);
        expect(after.a.events).toEqual(before.a.events);
        expect(after.b.events).toEqual(before.b.events);
      } else {
        expect(simulate(parsed.value.config).events).toEqual(simulate(structuredClone(preset.config)).events);
      }
    }
  });

  it('rejects invalid, huge, stale-result and newer-version JSON with useful errors', () => {
    expect(parseScenarioJson('{nope').ok).toBe(false);
    expect(parseScenarioJson('[]')).toEqual({ ok: false, error: 'A scenario must be one JSON object.' });
    expect(errorOf(parseScenarioJson(`{"format":"packetjourney-ai/scenario","version":2,"modelVersion":"14"}`))).toContain('newer than supported');
    expect(errorOf(parseScenarioJson(' '.repeat(MAX_SCENARIO_BYTES + 1)))).toContain('safe limit');

    const base = createScenarioFile('safe', structuredClone(presetById('udp-echo').config), 'valid');
    expect(errorOf(parseScenarioJson(JSON.stringify({ ...base, events: [{ fake: true }] })))).toContain('Unrecognized key');
    expect(errorOf(parseScenarioJson(JSON.stringify({ ...base, config: { ...base.config, ttl: 0 } })))).toContain('config.ttl');
  });

  it('exports only the declared scenario fields and refuses extra config keys', () => {
    const file = createScenarioFile('safe', structuredClone(presetById('tcp-hello').config), 'valid');
    expect(Object.keys(file)).toEqual(['format', 'version', 'modelVersion', 'name', 'cookieB', 'config']);
    const tainted = { ...structuredClone(file.config), AI_API_KEY: 'must-not-export' } as SimConfig;
    expect(() => createScenarioFile('tainted', tainted, 'valid')).toThrow('Unrecognized key');
  });

  it('keeps committed examples equal to their named deterministic presets', () => {
    for (const preset of PRESETS) {
      const text = readFileSync(new URL(`../../examples/${preset.id}.json`, import.meta.url), 'utf8');
      const parsed = parseScenarioJson(text);
      expect(parsed.ok, preset.id).toBe(true);
      if (!parsed.ok) continue;
      expect(parsed.value.name).toBe(preset.name);
      expect(parsed.value.cookieB).toBe(preset.cookieB);
      expect(sameConfig(parsed.value.config, preset.config)).toBe(true);
    }
  });
});
