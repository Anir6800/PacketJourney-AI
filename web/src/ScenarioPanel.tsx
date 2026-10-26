import { useRef, useState } from 'react';
import { PRESETS, presetById, type CookieChoice, type PresetId, type SimConfig } from '@packetjourney/shared';
import { MAX_SCENARIO_BYTES, parseScenarioJson, scenarioJson, type ScenarioFile } from '@packetjourney/shared/scenario';
import { HudLabel, StateView } from './ui.tsx';

type Props = {
  config: Readonly<SimConfig>;
  cookieB: CookieChoice;
  presetId: PresetId;
  notice: string;
  onPreset: (id: PresetId, director: boolean) => void;
  onImport: (file: ScenarioFile) => void;
  onReset: () => void;
};

export function ScenarioPanel({ config, cookieB, presetId, notice, onPreset, onImport, onReset }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const preset = presetById(presetId);

  const exportJson = () => {
    const text = scenarioJson('Exported lab scenario', structuredClone(config), cookieB);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'packetjourney-scenario.json';
    a.click();
    URL.revokeObjectURL(url);
    setStatus({ kind: 'ok', text: 'Scenario exported locally. It contains config, seed and model version only.' });
  };

  const importJson = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_SCENARIO_BYTES) {
      setStatus({ kind: 'error', text: `Import rejected: ${file.size.toLocaleString()} bytes exceeds the ${MAX_SCENARIO_BYTES.toLocaleString()}-byte safe limit.` });
      return;
    }
    try {
      const parsed = parseScenarioJson(await file.text());
      if (!parsed.ok) {
        setStatus({ kind: 'error', text: `Import rejected: ${parsed.error}` });
        return;
      }
      onImport(parsed.value);
      setStatus({ kind: 'ok', text: `Imported “${parsed.value.name}”. Events were regenerated from its config.` });
    } catch {
      setStatus({ kind: 'error', text: 'Import failed while reading the local file. Choose it again or export a fresh copy.' });
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <section className="scenario-tools" aria-label="Save, replay and present">
      <HudLabel>Save & present</HudLabel>
      <label htmlFor="preset">Named preset</label>
      <select id="preset" className="field" value={presetId} onChange={(e) => onPreset(e.target.value as PresetId, false)}>
        {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="preset-note" data-testid="preset-note">
        <strong>{preset.demonstrates}</strong>
        <span className="small muted">{preset.simulated}</span>
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={() => onPreset(presetId, false)}>Load preset</button>
        <button type="button" className="btn btn-primary" data-testid="start-director" onClick={() => onPreset(presetId, true)}>Present in Director</button>
      </div>
      <div className="row">
        <button type="button" className="btn" onClick={exportJson}>Export JSON</button>
        <button type="button" className="btn" onClick={() => input.current?.click()}>Import JSON</button>
        <input ref={input} className="sr-only" type="file" accept="application/json,.json" aria-label="Import scenario JSON" onChange={(e) => void importJson(e.target.files?.[0])} />
        <button type="button" className="btn" onClick={() => window.print()}>Print run summary</button>
      </div>
      <button type="button" className="btn btn-danger" onClick={onReset}>Reset demo & local data</button>
      <p className="small muted">Imports never use saved events: this model regenerates every event and snapshot. API keys and AI chat are outside the file schema.</p>
      {notice && <StateView kind={notice.includes('unavailable') ? 'error' : 'empty'} title={notice} />}
      {status && <p className={status.kind === 'error' ? 'field-error' : 'ok'} role={status.kind === 'error' ? 'alert' : 'status'}>{status.kind === 'error' ? '✕ ' : '✓ '}{status.text}</p>}
    </section>
  );
}
