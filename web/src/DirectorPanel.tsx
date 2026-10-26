import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PRESETS, type PresetId } from '@packetjourney/shared';
import { TypedConsole } from './TypedConsole.tsx';
import { AUTO_HOLD_MS, CHAPTERS, STORY_CPS, type Beat } from './story/script.ts';
import type { StoryState } from './story/questions.ts';

type Props = {
  beats: Beat[];
  story: StoryState;
  setStory: (f: (s: StoryState) => StoryState) => void;
  presetId: PresetId;
  playing: boolean;
  reduced: boolean;
  onPlaying: (playing: boolean) => void;
  onPreset: (id: PresetId) => void;
  onExit: () => void;
};

export function DirectorPanel(p: Props) {
  const bi = Math.min(p.story.beat, p.beats.length - 1);
  const beat = p.beats[bi];
  if (!beat) return null;
  return <DirectorBeat key={beat.id} {...p} beat={beat} bi={bi} />;
}

function DirectorBeat({ beat, bi, beats, setStory, presetId, playing, reduced, onPlaying, onPreset, onExit }: Props & { beat: Beat; bi: number }) {
  const [typed, setTyped] = useState(false);
  const last = bi === beats.length - 1;
  const go = (index: number) => setStory((s) => ({ ...s, beat: Math.max(0, Math.min(beats.length - 1, index)) }));
  const actions = useRef({ go, toggle: () => onPlaying(!playing), exit: onExit });
  useLayoutEffect(() => { actions.current = { go, toggle: () => onPlaying(!playing), exit: onExit }; });

  useEffect(() => {
    if (!playing || !typed) return;
    const timer = setTimeout(() => {
      if (last) onPlaying(false);
      else go(bi + 1);
    }, AUTO_HOLD_MS);
    return () => clearTimeout(timer);
  }, [playing, typed, last, bi]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, dialog[open]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        actions.current.exit();
      } else if (e.key === ' ') {
        e.preventDefault();
        actions.current.toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        actions.current.go(bi + 1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        actions.current.go(bi - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bi]);

  const chapter = CHAPTERS.find((c) => c.id === beat.chapter);
  return (
    <section className="director" data-testid="director" data-beat={beat.id} data-playing={playing} data-complete={last && !playing} aria-label="Director mode">
      <div className="director-head">
        <strong>DIRECTOR · {playing ? 'PLAYING' : last ? 'COMPLETE' : 'PAUSED'}</strong>
        <button type="button" className="btn" onClick={onExit}>Exit · Esc</button>
      </div>
      <label htmlFor="director-preset">Preset</label>
      <select id="director-preset" className="field" value={presetId} onChange={(e) => onPreset(e.target.value as PresetId)}>
        {PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select>
      <ol className="director-chapters" aria-label="Director chapters">
        {CHAPTERS.map((c) => {
          const index = beats.findIndex((b) => b.chapter === c.id);
          return index < 0 ? null : (
            <li key={c.id}>
              <button type="button" className="btn" aria-pressed={c.id === beat.chapter} onClick={() => go(index)}>{c.label}</button>
            </li>
          );
        })}
      </ol>
      <p className="hud-label">{chapter?.label} · beat {bi + 1} / {beats.length} · {beat.rig} camera rig</p>
      <TypedConsole lines={[beat.title, ...beat.lines]} cps={STORY_CPS} reduced={reduced} paused={!playing} onDone={() => setTyped(true)} label="Director caption" testId="director-caption" />
      <div className="row director-controls">
        <button type="button" className="btn" disabled={bi === 0} onClick={() => go(bi - 1)}>Previous</button>
        <button type="button" className="btn btn-primary" aria-pressed={playing} onClick={() => onPlaying(!playing)}>{playing ? 'Pause · Space' : last ? 'Replay · Space' : 'Play · Space'}</button>
        <button type="button" className="btn" disabled={last} onClick={() => go(bi + 1)}>Next</button>
      </div>
      <p className="small muted">Captions and camera rigs are driven by regenerated engine events. AI is not used. All timing is SIMULATED.</p>
    </section>
  );
}
