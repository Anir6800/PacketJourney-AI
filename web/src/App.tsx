import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SIM,
  RunController,
  continueHttpSession,
  explain,
  hex,
  httpSessionConfigs,
  representations,
  sameConfig,
  presetById,
  validateSimConfig,
  bin,
  type CookieChoice,
  type HealthResponse,
  type HttpSessionRun,
  type PresetId,
  type SimConfig,
  type SimState,
  type TemplateId,
} from '@packetjourney/shared';
import { Journey2D } from './Journey2D.tsx';
import { EventLog } from './EventLog.tsx';
import { Stage2D } from './Stage2D.tsx';
import { TypedConsole } from './TypedConsole.tsx';
import { HudLabel, Segmented, StateView, Tabs, useMediaQuery } from './ui.tsx';
import { LAYERS, LayerGlyph, type LayerId } from './layers.tsx';
import { SnapshotDetail } from './SnapshotDetail.tsx';
import { DeviceDetail } from './DeviceDetail.tsx';
import { sceneModel } from './scene/model.ts';
import { selection, useSelection, type Selection } from './selection.ts';
import { fmtTime } from './format.ts';
import {
  DEFAULT_PREFERENCES,
  clearLocalDemoData,
  hasWebGL,
  loadPreferences,
  readStoredScenario,
  removeStoredScenario,
  savePreferences,
  saveStoredScenario,
  type Motion,
  type View,
} from './settings.ts';
import { MessageEntry, RunBoot } from './Intro.tsx';
import { gsap, loadFlip, useGSAP } from './gsap.ts';
import { ease } from './tokens.ts';
import { buildCues, locate, spanOf } from './motion/cues.ts';
import { SPEEDS, type Speed } from './motion/clock.ts';
import { MotionContext, createMotion, setCues } from './motion/motion.ts';
import { Ladder } from './Ladder.tsx';
import { CueOverlay } from './CueOverlay.tsx';
import { FaultChain } from './faults/FaultPanels.tsx';
import { debug } from './debug.ts';
import { StoryPanel } from './StoryPanel.tsx';
import { buildStory } from './story/script.ts';
import { INITIAL_STORY, loadStory, saveStory, type StoryState } from './story/questions.ts';
import { RunSummary } from './RunSummary.tsx';
import type { ScenarioFile } from '@packetjourney/shared/scenario';

const JourneyStage3D = lazy(() => import('./JourneyStage3D.tsx'));
// Lab-only UI loads on demand: Story Mode is the first-run default (keeps the initial bundle within budget).
const ConfigForm = lazy(() => import('./ConfigForm.tsx').then((m) => ({ default: m.ConfigForm })));
const HeaderView = lazy(() => import('./HeaderView.tsx').then((m) => ({ default: m.HeaderView })));
const FieldDetail = lazy(() => import('./HeaderView.tsx').then((m) => ({ default: m.FieldDetail })));
const SessionPanel = lazy(() => import('./SessionPanel.tsx').then((m) => ({ default: m.SessionPanel })));
const CompareView = lazy(() => import('./CompareView.tsx').then((m) => ({ default: m.CompareView })));
const PracticeView = lazy(() => import('./PracticeView.tsx').then((m) => ({ default: m.PracticeView })));
const TutorPanel = lazy(() => import('./tutor/TutorPanel.tsx').then((m) => ({ default: m.TutorPanel })));
const FaultEditor = lazy(() => import('./faults/FaultEditor.tsx').then((m) => ({ default: m.FaultEditor })));
const ScenarioPanel = lazy(() => import('./ScenarioPanel.tsx').then((m) => ({ default: m.ScenarioPanel })));
const loadOpening = () => Promise.all([import('./Opening.tsx'), loadFlip()]).then(([m]) => m);
const Opening = lazy(() => loadOpening().then((m) => ({ default: m.Opening })));
const DirectorPanel = lazy(() => import('./DirectorPanel.tsx').then((m) => ({ default: m.DirectorPanel })));

type Ai = 'checking' | 'online' | 'unconfigured' | 'offline';
type Mode = 'story' | 'lab' | 'director';
type Tab = 'journey' | 'headers' | 'scopes' | 'compare' | 'practice';
type Proto = 'TCP' | 'UDP';

const TABS = [
  { id: 'journey', label: 'Journey' },
  { id: 'headers', label: 'Headers' },
  { id: 'scopes', label: 'Delivery scopes' },
  { id: 'compare', label: 'Compare' },
  { id: 'practice', label: 'Practice' },
] as const;

const WORDMARK = 'PacketJourney';

const field = (s: SimState, id: string) => s.fields.find((f) => f.id === id);
const hex16 = (n: number | null | undefined) => `0x${hex(n ?? 0, 4)}`;

/** Console lines are read from the snapshot only. */
function consoleLines(s: SimState, proto: Proto, scope: TemplateId): string[] {
  const app = s.units.app ?? [];
  const seg = s.units.transport ?? [];
  const pkt = s.units.internet ?? [];
  const frame = s.units.link ?? [];
  const shown = app.slice(0, 16).map((b) => hex(b)).join(' ') + (app.length > 16 ? ' …' : '');
  const l4 = proto === 'TCP' ? 'tcp' : 'udp';
  const pad = field(s, 'padding.bytes')?.raw ?? 0;
  return [
    `encode → ${app.length} bytes UTF-8: ${shown}`,
    `${proto} header ${seg.length - app.length} B → ${proto === 'TCP' ? 'segment' : 'datagram'} ${seg.length} B · checksum ${hex16(field(s, `${l4}.checksum`)?.raw)}`,
    `IPv4 header 20 B → packet ${pkt.length} B · total length ${field(s, 'ipv4.totalLength')?.raw} · checksum ${hex16(field(s, 'ipv4.checksum')?.raw)}`,
    `Ethernet II 14 B${pad ? ` + pad ${pad} B` : ''} + FCS 4 B → frame ${frame.length} B · FCS ${field(s, 'fcs.crc32')?.display}`,
    `scope: ${scope} · single ${proto === 'TCP' ? 'segment' : 'datagram'} · all values SIMULATED`,
  ];
}

export function App() {
  const root = useRef<HTMLDivElement>(null);
  const osReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [initialPreferences] = useState(loadPreferences);
  const [motionPref, setMotion] = useState<Motion | null>(initialPreferences.value.motion);
  const motion: Motion = motionPref ?? (osReduced ? 'reduced' : 'cinematic');
  const reduced = motion === 'reduced';
  const [storageNotice, setStorageNotice] = useState(() =>
    initialPreferences.state === 'recovered'
      ? 'Corrupt local preferences were cleared and defaults restored.'
      : initialPreferences.state === 'unavailable'
        ? 'Local storage is unavailable; settings and progress work for this tab only.'
        : '',
  );

  // Story Mode is the first-run default; the choice and story progress persist for the session (resumable).
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return sessionStorage.getItem('pj.mode') === 'lab' ? 'lab' : 'story';
    } catch {
      return 'story';
    }
  });
  const [intro, setIntro] = useState<'entry' | 'questions' | 'boot' | 'opening' | 'ready'>(() => {
    try { return sessionStorage.getItem('pj.booted') === '1' ? 'ready' : 'entry'; }
    catch { return 'entry'; }
  });
  const [entryText, setEntryText] = useState('');
  const [chromeIdle, setChromeIdle] = useState(false);
  const [entrance, setEntrance] = useState(false);
  const [story, setStory] = useState<StoryState>(loadStory);
  const [view, setView] = useState<View>(initialPreferences.value.view);
  const [presetId, setPresetId] = useState<PresetId>('tcp-hello');
  const [directorPlaying, setDirectorPlaying] = useState(false);
  const [practiceKey, setPracticeKey] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  // A real GPU loss the browser never restores would strand the app in 2D: remount a fresh canvas after a pause.
  const [glKey, setGlKey] = useState(0);
  useEffect(() => {
    if (!contextLost) return;
    const t = window.setTimeout(() => { setContextLost(false); setGlKey((k) => k + 1); }, 4000);
    return () => window.clearTimeout(t);
  }, [contextLost]);
  const [tab, setTab] = useState<Tab>('journey');
  const [ai, setAi] = useState<Ai>('checking');
  /** Field ids the tutor referenced: pulse once in the inspector (the key restarts the animation). */
  const [pulse, setPulse] = useState<{ ids: string[]; n: number }>({ ids: [], n: 0 });
  const sel = useSelection();
  const selected: LayerId = sel.kind === 'layer' ? sel.layer : 'transport';
  /** True when the inspector shows the shared 3D/2D selection rather than an event snapshot or header field. */
  const [showSel, setShowSel] = useState(false);
  const [docHidden, setDocHidden] = useState(() => document.hidden);
  const [selectedField, setSelectedField] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<number | null>(null);
  // The one playback clock + paused GSAP master timeline (created once; StrictMode reuses the same object).
  const [mo] = useState(createMotion);
  /** Current event index, set by the clock only when it changes (never per frame). */
  const [step, setStep] = useState(0);
  const [clockUi, setClockUi] = useState<{ playing: boolean; speed: Speed }>({ playing: false, speed: 1 });
  const [hiddenPause, setHiddenPause] = useState(false);
  const tsRef = useRef<HTMLSpanElement>(null);
  const holdRef = useRef<HTMLSpanElement>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  // One controller per app; each Run freezes the config and replaces the previous run entirely.
  // Created together in one initializer so StrictMode's double call can't start two runs on one controller.
  const [{ controller, first }] = useState(() => {
    const c = new RunController();
    // A story in progress resumes its own (deterministic) run.
    const saved = loadStory();
    return { controller: c, first: c.start(structuredClone(saved.phase === 'play' && saved.config ? saved.config : DEFAULT_SIM)) };
  });
  const [latest, setRun] = useState(first);
  /** HTTP mode: both connections plus the draft and cookie choice that produced them. */
  const [ses, setSes] = useState<{ s: HttpSessionRun; base: SimConfig; cookieB: CookieChoice } | null>(null);
  const [conn, setConn] = useState<'a' | 'b'>('a');
  const [cookieB, setCookieB] = useState<CookieChoice>('valid');
  /** The connection on stage: the single run, or connection A/B of the session demo. */
  const run = useMemo(() => (ses ? { ...(conn === 'a' ? ses.s.a : ses.s.b), runId: latest.runId } : latest), [ses, conn, latest]);
  /** Editable draft; the stage always shows the last run's config until the user runs it. */
  const [draft, setDraft] = useState<SimConfig>(() => structuredClone(first.config));
  const proto = draft.protocol;
  // UDP supports raw echo only, so switching to UDP leaves HTTP/session mode.
  const setProto = (p: Proto) => setDraft((d) => ({ ...d, protocol: p, payloadMode: p === 'UDP' ? 'raw' : d.payloadMode }));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const help = useRef<HTMLDialogElement>(null);
  const inspector = useRef<HTMLElement>(null);

  const drawer = useMediaQuery('(max-width: 1280px) and (min-width: 769px)');

  // The 3D chunk loads after the intro: loading/compiling it during the intro stalls the main thread and stretches it.
  const booting = intro !== 'ready';

  useEffect(() => {
    document.documentElement.dataset.motion = motion;
    document.documentElement.dataset.theme = initialPreferences.value.theme;
  }, [motion, initialPreferences.value.theme]);

  useEffect(() => {
    if (!savePreferences({ ...DEFAULT_PREFERENCES, motion: motionPref, view }))
      queueMicrotask(() => setStorageNotice('Local storage is unavailable; settings and progress work for this tab only.'));
  }, [motionPref, view]);

  useEffect(() => {
    const sync = () => {
      document.documentElement.dataset.hidden = String(document.hidden);
      setDocHidden(document.hidden);
      // A hidden tab pauses playback, with a visible note in the dock.
      if (document.hidden && mo.clock.state.playing) {
        mo.clock.pause();
        setHiddenPause(true);
      }
      if (document.hidden && mode === 'director' && directorPlaying) {
        setDirectorPlaying(false);
        setHiddenPause(true);
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [mo, mode, directorPlaying]);

  // Clock → master timeline, 3D ref, panels (on event change only), dock DOM text. One subscription.
  useEffect(() => {
    let lastIdx = -2;
    let ui = '';
    const unsub = mo.clock.subscribe((s) => {
      const pos = locate(mo.cues.current, s.pt);
      mo.pos.current = pos;
      mo.master.time(s.pt);
      if (pos.index !== lastIdx) {
        lastIdx = pos.index;
        setStep(Math.max(0, pos.index));
      }
      const u = `${s.playing}|${s.speed}`;
      if (u !== ui) {
        ui = u;
        setClockUi({ playing: s.playing, speed: s.speed });
      }
      if (tsRef.current) tsRef.current.textContent = `t = ${fmtTime(pos.vt)}`;
      if (holdRef.current) holdRef.current.textContent = pos.cue?.hold ? 'teaching hold · presentation only' : pos.cue ? 'virtual time advancing' : '';
      if (scrubRef.current && document.activeElement !== scrubRef.current) scrubRef.current.value = String(s.pt);
    });
    if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
      debug.motion = () => {
        const s = mo.clock.state;
        const p = locate(mo.cues.current, s.pt);
        return {
          pt: s.pt, playing: s.playing, speed: s.speed, duration: s.duration, index: p.index, progress: p.progress, vt: p.vt, kind: p.cue?.kind ?? null,
          loops: mo.clock.loops, consumedMs: mo.clock.consumedMs, masterTime: mo.master.time(), masterDuration: mo.master.duration(), span: spanOf(mo.cues.current),
          activeTweens: debug.gsapActive(),
        };
      };
      debug.seek = (pt: number) => mo.clock.seek(pt);
    }
    return () => {
      unsub();
      mo.clock.pause(); // no orphan rAF after unmount (and StrictMode's test unmount)
    };
  }, [mo]);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/health', { signal: ctrl.signal })
      .then((r) => r.json())
      .then((j: unknown) => {
        // ponytail: structural check instead of zod here keeps zod out of the browser bundle; the server validates with HealthResponse.
        const h = j as Partial<HealthResponse> | null;
        if (h?.ok !== true || typeof h.aiConfigured !== 'boolean') throw new Error('bad /api/health body');
        setAi(h.aiConfigured ? 'online' : 'unconfigured');
      })
      .catch(() => !ctrl.signal.aborted && setAi('offline'));
    return () => ctrl.abort();
  }, []);

  useEffect(() => {
    if (drawer && drawerOpen) inspector.current?.focus();
  }, [drawer, drawerOpen]);

  const issues = validateSimConfig(draft);
  const dirty = ses ? !sameConfig(draft, ses.base) || cookieB !== ses.cookieB : !sameConfig(draft, latest.config);
  const snap = run.timeline.final;
  const runProto = run.config.protocol;

  const lines = consoleLines(snap, runProto, run.config.template);
  const sentText = new TextDecoder().decode(Uint8Array.from(run.events.find((e) => e.tag === 'app:send')?.bytes ?? []));
  const reps = representations(sentText);
  const evSnap = selectedEvent === null ? null : run.timeline.at(selectedEvent);
  const journeyIndex = Math.min(step, run.events.length - 1);
  const cues = useMemo(() => buildCues(run.events), [run]);
  // New run (or A/B switch): new cues and labels; paused at the end so the full result shows, like before playback existed.
  useLayoutEffect(() => {
    setCues(mo, cues);
    mo.clock.reset(spanOf(cues), spanOf(cues));
    mo.sync();
  }, [mo, cues]);
  const seekEvent = (i: number) => {
    const c = cues[Math.max(0, Math.min(cues.length - 1, i))];
    if (!c) return;
    mo.clock.pause();
    // Land at the end of the event's cue: its state is fully shown.
    mo.clock.seek(c.endPT - 1e-6);
  };
  const play = () => {
    setHiddenPause(false);
    mo.clock.toggle();
  };
  const resetPlayback = () => {
    mo.clock.pause();
    mo.clock.seek(0);
  };

  const persistScenario = (name: string, config: SimConfig, savedCookie: CookieChoice) => {
    void import('@packetjourney/shared/scenario')
      .then(({ scenarioJson }) => {
        if (!saveStoredScenario(scenarioJson(name, config, savedCookie)))
          setStorageNotice('Local storage is unavailable; settings and progress work for this tab only.');
      })
      .catch(() => setStorageNotice('The saved configuration could not be prepared; this run is still available in the current tab.'));
  };

  const runConfig = (config: SimConfig, savedCookie: CookieChoice, name = 'Saved lab scenario', persist = true): boolean => {
    if (validateSimConfig(config).length) return false;
    if (config.payloadMode === 'http') {
      const a = controller.start(httpSessionConfigs(config).a);
      setRun(a);
      setSes({ s: continueHttpSession(a, config, savedCookie), base: structuredClone(config), cookieB: savedCookie });
      setConn('a');
    } else {
      setRun(controller.start(config));
      setSes(null);
    }
    setSelectedEvent(null);
    setSelectedField(null);
    if (persist) persistScenario(name, config, savedCookie);
    return true;
  };
  const startRun = () => runConfig(draft, cookieB);
  const resetDraft = () => {
    setDraft(structuredClone(ses ? ses.base : latest.config));
    if (ses) setCookieB(ses.cookieB);
  };
  const loadPreset = (id: PresetId, director: boolean) => {
    const preset = presetById(id);
    const config = structuredClone(preset.config);
    setPresetId(id);
    setDraft(config);
    setCookieB(preset.cookieB);
    if (!runConfig(config, preset.cookieB, preset.name)) return;
    if (director) {
      if (!hasWebGL()) setView('2d');
      setStory({ ...INITIAL_STORY, phase: 'play', config });
      setDirectorPlaying(true);
      setMode('director');
    } else {
      setDirectorPlaying(false);
      setMode('lab');
    }
  };
  const importScenario = (file: ScenarioFile) => {
    const config = structuredClone(file.config);
    setDraft(config);
    setCookieB(file.cookieB);
    runConfig(config, file.cookieB, file.name);
    setDirectorPlaying(false);
    setMode('lab');
  };
  const resetDemo = () => {
    const available = clearLocalDemoData();
    try {
      sessionStorage.removeItem('pj.story');
      sessionStorage.removeItem('pj.mode');
    } catch {
      // Session resume is optional.
    }
    const config = structuredClone(DEFAULT_SIM);
    setDraft(config);
    setCookieB('valid');
    setMotion(null);
    setView('3d');
    setPresetId('udp-echo');
    setStory(INITIAL_STORY);
    setDirectorPlaying(false);
    setPracticeKey((k) => k + 1);
    setMode('lab');
    runConfig(config, 'valid', 'UDP echo');
    setStorageNotice(available ? 'Demo settings, saved config and practice progress were reset to local defaults.' : 'Local storage is unavailable; the visible demo was reset for this tab only.');
  };
  const restoreScenario = useRef<(file: ScenarioFile) => void>(() => undefined);
  useLayoutEffect(() => {
    restoreScenario.current = (file) => {
      const config = structuredClone(file.config);
      setDraft(config);
      setCookieB(file.cookieB);
      runConfig(config, file.cookieB, file.name, false);
    };
  });
  useEffect(() => {
    if (story.phase === 'play') return;
    const saved = readStoredScenario();
    if (saved.state === 'unavailable') {
      queueMicrotask(() => setStorageNotice('Local storage is unavailable; settings and progress work for this tab only.'));
      return;
    }
    if (!saved.text) return;
    let active = true;
    void import('@packetjourney/shared/scenario').then(({ parseScenarioJson }) => {
      if (!active) return;
      const parsed = parseScenarioJson(saved.text ?? '');
      if (parsed.ok) restoreScenario.current(parsed.value);
      else {
        removeStoredScenario();
        setStorageNotice(`Corrupt saved configuration was cleared: ${parsed.error}`);
      }
    });
    return () => { active = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const selectEvent = (i: number) => {
    seekEvent(i);
    setSelectedEvent(i);
    setSelectedField(null);
    setShowSel(false);
    openInspector();
  };
  /** One entry point for 3D clicks, 2D journey nodes and the layer stack. */
  useEffect(() => {
    try {
      sessionStorage.setItem('pj.mode', mode);
    } catch {
      // non-essential
    }
  }, [mode]);
  useEffect(() => saveStory(story), [story]);

  // Built only while a story or Director run plays (it re-runs the engine for its predictions).
  const storyPlaying = (mode === 'story' || mode === 'director') && story.phase === 'play';
  const beats = useMemo(() => (storyPlaying ? buildStory(run) : []), [run, storyPlaying]);
  const beat = storyPlaying ? beats[Math.min(story.beat, beats.length - 1)] : undefined;
  useEffect(() => {
    if (import.meta.env.DEV || import.meta.env.MODE === 'test') debug.story = () => beats.map((b) => ({ id: b.id, chapter: b.chapter, kind: b.kind, layer: b.layer, text: [b.title, ...b.lines] }));
  }, [beats]);
  const startStory = () => {
    if (validateSimConfig(draft).length) return false;
    if (!startRun()) return false;
    setStory((st) => ({ ...st, phase: 'play', beat: 0, config: structuredClone(draft) }));
    return true;
  };
  const ready = () => {
    try { sessionStorage.setItem('pj.booted', '1'); } catch { /* Session resume is optional. */ }
    setIntro('ready');
  };
  const beginFromIntro = () => {
    const ok = startStory();
    if (ok) {
      setMode('story');
      if (reduced) ready();
      else setIntro('boot');
    }
    return ok;
  };
  const newMessage = () => {
    setEntryText('');
    setEntrance(false);
    setDraft(structuredClone(DEFAULT_SIM));
    setStory(INITIAL_STORY);
    setMode('story');
    setIntro('entry');
  };
  const replayAsStory = () => {
    setStory((st) => ({ ...INITIAL_STORY, auto: st.auto, phase: 'play', config: structuredClone(run.config) }));
    setMode('story');
  };
  const setAppMode = (next: Mode) => {
    if (next === 'director') loadPreset(presetId, true);
    else {
      setDirectorPlaying(false);
      setMode(next);
    }
  };

  const pick = (s: Selection) => {
    selection.set(s);
    setShowSel(true);
    setSelectedField(null);
    openInspector();
  };
  const selField = selectedField ? field(snap, selectedField) : undefined;
  const webglWanted = view === '3d' && hasWebGL() && !booting;
  const webgl = webglWanted && !contextLost;
  const curEv = run.events[journeyIndex];
  const model = useMemo(
    () => sceneModel(run, journeyIndex, curEv ? `Step ${journeyIndex + 1} of ${run.events.length}: ${explain(curEv)}` : ''),
    [run, journeyIndex, curEv],
  );
  const fallbackReason = !hasWebGL() ? 'WebGL unavailable' : view === '2d' ? 'View set to 2D' : contextLost ? 'WebGL context lost' : booting ? 'Loading 3D stage after the intro…' : '';

  const unitLen = (l: LayerId) => (l === 'physical' ? 0 : (snap.units[l]?.length ?? 0));
  const inner: Record<string, LayerId | null> = { link: 'internet', internet: 'transport', transport: 'app', app: null };
  const stack = (['link', 'internet', 'transport', 'app'] as const).map((l) => {
    const i = inner[l];
    return { layer: l, total: unitLen(l), added: i ? unitLen(l) - unitLen(i) : 0 };
  });

  const openInspector = () => drawer && setDrawerOpen(true);

  const applyBeat = useRef<(b: NonNullable<typeof beat>) => void>(() => undefined);
  useLayoutEffect(() => {
    applyBeat.current = (b) => {
      seekEvent(b.event);
      setSelectedEvent(b.event);
      setSelectedField(null);
      if (b.layer) {
        selection.set({ kind: 'layer', layer: b.layer });
        setShowSel(true);
      } else setShowSel(false);
      setTab('journey');
    };
  });
  useEffect(() => {
    if (beat) applyBeat.current(beat);
  }, [beat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const keys = useRef({ seekEvent, play, resetPlayback, journeyIndex, storyActive: false });
  useLayoutEffect(() => {
    keys.current = { seekEvent, play, resetPlayback, journeyIndex, storyActive: Boolean(beat) };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="tablist"], dialog[open]')) return;
      const k = keys.current;
      if (k.storyActive) return; // the story player owns Space/arrows while a story is playing
      if (e.key === ' ' || e.key === 'k') {
        if (t?.closest('button, summary, a, [role="button"]')) return; // Space activates the focused control
        e.preventDefault();
        k.play();
      } else if (e.key === 'ArrowRight' || e.key === '.') {
        e.preventDefault();
        k.seekEvent(k.journeyIndex + 1);
      } else if (e.key === 'ArrowLeft' || e.key === ',') {
        e.preventDefault();
        k.seekEvent(k.journeyIndex - 1);
      } else if (e.key === 'Home') {
        e.preventDefault();
        k.resetPlayback();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const toggleFullscreen = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && document.fullscreenElement) {
        void document.exitFullscreen().catch(() => undefined);
        return;
      }
      if (e.key.toLowerCase() !== 'f' || e.altKey || e.ctrlKey || e.metaKey || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else void document.documentElement.requestFullscreen?.().catch(() => undefined);
    };
    window.addEventListener('keydown', toggleFullscreen);
    return () => window.removeEventListener('keydown', toggleFullscreen);
  }, []);

  useEffect(() => {
    if (intro !== 'ready') return;
    let timer = 0;
    const focusedControl = () => Boolean(document.activeElement?.closest('.hud, .inspector, .dock'));
    const wake = () => {
      setChromeIdle(false);
      window.clearTimeout(timer);
      if (document.fullscreenElement) timer = window.setTimeout(() => {
        if (!focusedControl()) setChromeIdle(true);
      }, 2500);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'i' && !(e.target instanceof HTMLInputElement)) setDrawerOpen(true);
      wake();
    };
    window.addEventListener('pointermove', wake, { passive: true });
    window.addEventListener('keydown', key);
    document.addEventListener('focusin', wake);
    document.addEventListener('fullscreenchange', wake);
    wake();
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', wake);
      window.removeEventListener('keydown', key);
      document.removeEventListener('focusin', wake);
      document.removeEventListener('fullscreenchange', wake);
    };
  }, [intro]);

  useEffect(() => {
    const el = root.current;
    if (intro !== 'ready' || reduced || !el || !window.matchMedia('(pointer: fine)').matches) return;
    let frame = 0;
    let pane: HTMLElement | null = null;
    let x = 0;
    let y = 0;
    const move = (e: PointerEvent) => {
      pane = e.target instanceof Element ? e.target.closest<HTMLElement>('.glass') : null;
      if (!pane) return;
      const box = pane.getBoundingClientRect();
      x = e.clientX - box.left;
      y = e.clientY - box.top;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        pane?.style.setProperty('--sheen-x', `${x}px`);
        pane?.style.setProperty('--sheen-y', `${y}px`);
        frame = 0;
      });
    };
    el.addEventListener('pointermove', move, { passive: true });
    return () => { el.removeEventListener('pointermove', move); cancelAnimationFrame(frame); };
  }, [intro, reduced]);

  // After the opening: one white light sweep, then glass chrome rises 12px from blurred to sharp. Never under Reduced.
  useGSAP(() => {
    if (!entrance || intro !== 'ready' || reduced) return;
    gsap.timeline()
      .fromTo('.sweep', { autoAlpha: 1, xPercent: -100 }, { xPercent: 100, duration: 0.9, ease: ease.inOut })
      .set('.sweep', { autoAlpha: 0 })
      .fromTo('.hud-enter', { autoAlpha: 0, y: 12, filter: 'blur(8px)' },
        { autoAlpha: 1, y: 0, filter: 'blur(0px)', duration: 0.6, ease: ease.out, stagger: 0.06, clearProps: 'filter,transform,opacity,visibility' }, 0.35);
  }, { scope: root, dependencies: [entrance, intro, reduced] });

  if (intro === 'entry') return <MessageEntry value={entryText} onChange={setEntryText} reduced={reduced}
    directorMessage={presetById('tcp-hello').config.request} onDirector={() => {
      loadPreset('tcp-hello', true);
      if (!reduced) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      if (reduced) ready(); else setIntro('boot');
    }} onEnter={() => {
    setDraft((d) => ({ ...d, request: entryText }));
    setStory({ ...INITIAL_STORY, q: 1 });
    if (!reduced) void document.documentElement.requestFullscreen?.().catch(() => undefined);
    setIntro('questions');
  }} />;
  if (intro === 'questions') return <main className="intro intro-questions" data-testid="intro-questions">
    <StoryPanel draft={draft} setDraft={setDraft} beats={[]} story={story} setStory={setStory} reduced={reduced}
      onStart={beginFromIntro} onSkip={beginFromIntro} onBackToEntry={() => setIntro('entry')} onPractice={() => undefined} minimal />
    <span className="intro-tag mono">SIMULATED · local</span>
  </main>;
  if (intro === 'boot') void loadOpening(); // prefetch during the ≤ 3 s boot
  if (intro === 'boot') return <RunBoot lines={lines} onComplete={() => setIntro('opening')} />;
  if (intro === 'opening') return <MotionContext.Provider value={mo}><Suspense fallback={<main className="intro" />}>
    <Opening run={run} beats={beats} cues={cues} motion={mo} onComplete={() => {
      const journey = beats.findIndex((b) => b.chapter === 'journey');
      if (journey >= 0) setStory((s) => ({ ...s, beat: journey }));
      setEntrance(true);
      ready();
    }} />
  </Suspense></MotionContext.Provider>;

  return (
    <MotionContext.Provider value={mo}>
    <div className="app" ref={root} data-chrome-idle={chromeIdle} data-fullstage={webgl && tab === 'journey'} onKeyDown={(e) => e.key === 'Escape' && drawerOpen && setDrawerOpen(false)}>
      <p className="sr-only" aria-live="polite" data-testid="announcer">
        {curEv ? `Step ${journeyIndex + 1}: ${curEv.tag}. ${explain(curEv)}` : ''}
      </p>
      <div className="sweep" aria-hidden="true" />
      <div className="grid-bg" aria-hidden="true">
        <div className="grid-plane" />
      </div>

      <header className="hud glass hud-enter">
        <h1 className="wordmark">
          <span className="sr-only">PacketJourney AI</span>
          <span aria-hidden="true">
            <span className="wordmark-text">{WORDMARK}</span> <span className="accent">AI</span>
          </span>
        </h1>
        <span className="badge badge-sim" data-testid="simulated-badge" title="All packets, timings and results are simulated. No real network traffic.">
          SIMULATED
        </span>
        <div className="hud-controls">
          <button type="button" className="btn" onClick={newMessage}>New message</button>
          <Segmented label="Mode" value={mode} onChange={setAppMode} options={[{ value: 'story', label: 'Story' }, { value: 'lab', label: 'Lab' }, { value: 'director', label: 'Director' }]} />
          {mode !== 'director' && <Segmented label="Protocol" value={proto} onChange={setProto} options={[{ value: 'TCP', label: 'TCP' }, { value: 'UDP', label: 'UDP' }]} />}
          <Segmented label="Motion" value={motion} onChange={setMotion} options={[{ value: 'cinematic', label: 'Cinematic' }, { value: 'reduced', label: 'Reduced' }]} />
          <Segmented label="View" value={view} onChange={(v) => { setView(v); if (v === '3d') setContextLost(false); }} options={[{ value: '3d', label: '3D' }, { value: '2d', label: '2D' }]} />
          {drawer && (
            <button type="button" className="btn" aria-expanded={drawerOpen} aria-controls="inspector" onClick={() => setDrawerOpen((o) => !o)}>
              Inspector
            </button>
          )}
          <button type="button" className="btn btn-icon" aria-label="Help" onClick={() => help.current?.showModal()}>
            ?
          </button>
        </div>
      </header>

      <main className="layout">
        <aside className={`rail glass hud-enter${mode !== 'lab' ? ' rail-story' : ''}`} aria-label={mode === 'story' ? 'Story' : mode === 'director' ? 'Director' : 'Configuration'}>
          <HudLabel>{mode === 'story' ? 'Story Mode' : mode === 'director' ? 'Director Mode' : 'Lab Mode'}</HudLabel>
          {mode === 'story' ? (
            <StoryPanel
              draft={draft}
              setDraft={setDraft}
              beats={beats}
              story={story}
              setStory={setStory}
              reduced={reduced}
              onStart={startStory}
              onPractice={() => setTab('practice')}
            />
          ) : mode === 'director' ? (
            <Suspense fallback={<StateView kind="loading" title="Loading Director…" />}>
              <DirectorPanel
                beats={beats}
                story={story}
                setStory={setStory}
                presetId={presetId}
                playing={directorPlaying}
                reduced={reduced}
                onPlaying={(playing) => {
                  if (playing && story.beat >= beats.length - 1) setStory((s) => ({ ...s, beat: 0 }));
                  setDirectorPlaying(playing);
                  setHiddenPause(false);
                }}
                onPreset={(id) => loadPreset(id, true)}
                onExit={() => {
                  setDirectorPlaying(false);
                  setMode('lab');
                }}
              />
            </Suspense>
          ) : (
            <>
              <p className="muted small">Free lab: every setting below. The story's answers live here too.</p>
              <button type="button" className="btn" data-testid="replay-story" onClick={replayAsStory}>
                Replay this run as a story
              </button>
              <Suspense fallback={<StateView kind="loading" title="Loading save and presentation tools…" />}>
                <ScenarioPanel
                  config={ses ? ses.base : latest.config}
                  cookieB={ses?.cookieB ?? cookieB}
                  presetId={presetId}
                  notice={storageNotice}
                  onPreset={loadPreset}
                  onImport={importScenario}
                  onReset={resetDemo}
                />
              </Suspense>
              <Suspense fallback={<StateView kind="loading" title="Loading Lab controls…" />}>
                <ConfigForm
                  draft={draft}
                  setDraft={setDraft}
                  issues={issues}
                  dirty={dirty}
                  onRun={startRun}
                  onReset={resetDraft}
                  runInfo={`Run #${run.runId} · seed ${run.config.seed} · ${run.config.protocol} · ${run.config.template}${ses ? ` · HTTP session, connection ${conn.toUpperCase()}` : ''}`}
                  cookieB={cookieB}
                  setCookieB={setCookieB}
                />
                <HudLabel>Faults</HudLabel>
                <FaultEditor draft={draft} setDraft={setDraft} issues={issues} />
              </Suspense>
            </>
          )}
        </aside>

        <section className="stage glass hud-enter" aria-label="Journey stage">
          <div className="stage-overlay">
            <Tabs label="Stage views" tabs={TABS} value={tab} onChange={setTab} />
            <div className="tab-panel scrim" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'journey' && (
                <>
                  {ses && (
                    <Suspense fallback={null}><SessionPanel
                      ses={ses.s}
                      conn={conn}
                      onConn={(c) => {
                        setConn(c);
                        setSelectedEvent(null);
                        setSelectedField(null);
                      }}
                    /></Suspense>
                  )}
                  {/* Full-stage (wide screens): the 3D canvas is a fixed backdrop; this window lets it show through. */}
                  <div className="viewport-hole" aria-hidden="true" />
                  <div className="viewport">
                    {webglWanted && (
                      <div className="viewport-3d" hidden={contextLost}>
                        <Suspense fallback={<Stage2D reason="Loading 3D stage… the 2D journey below is ready" packet={model.packet} />}>
                          <JourneyStage3D
                            key={glKey}
                            model={model}
                            selected={sel}
                            onSelect={pick}
                            reduced={reduced}
                    playing={clockUi.playing || (mode === 'director' && directorPlaying)}
                            motion={mo}
                            rig={beat?.rig}
                            hidden={docHidden || contextLost}
                            onContextLost={() => setContextLost(true)}
                            onContextRestored={() => setContextLost(false)}
                          />
                        </Suspense>
                      </div>
                    )}
                    {!webgl && <Stage2D reason={fallbackReason} packet={model.packet} />}
                    <CueOverlay run={run} cues={cues} reduced={reduced} />
                  </div>
                  <FaultChain events={run.events} step={journeyIndex} onStep={selectEvent} />
                  <Journey2D
                    key={`${run.runId}:${conn}`}
                    run={run}
                    index={journeyIndex}
                    onStep={selectEvent}
                    selectedDevice={sel.kind === 'device' ? sel.id : null}
                    onSelectDevice={(id) => pick({ kind: 'device', id })}
                    scope={beat?.scope ?? undefined}
                    fx={{ timers: model.timers, notice: model.notice }}
                  />
                  {/* Story/Director keep the stage calm: secondary views fold away (Lab opens them by default). */}
                  <details className="more" key={mode} open={mode === 'lab' || undefined}>
                    <summary className="more-summary">More detail · ladder, layers, bytes, console, event log</summary>
                    <Ladder run={run} cues={cues} reduced={reduced} />
                    <ol className="stack" aria-label="Layer stack (SIMULATED)">
                      {stack.map((r) => (
                        <li key={r.layer}>
                          <button
                            type="button"
                            className="stack-row"
                            style={{ '--layer': `var(--c-${r.layer})` } as React.CSSProperties}
                            aria-pressed={!selectedField && sel.kind === 'layer' && selected === r.layer}
                            onClick={() => pick({ kind: 'layer', layer: r.layer })}
                          >
                            <LayerGlyph layer={r.layer} />
                            <span className="code mono">{LAYERS[r.layer].code}</span>
                            <span className="name">{LAYERS[r.layer].name}</span>
                            <span className="bytes mono">
                              {r.added > 0 && `+${r.added} B · `}
                              {r.total} B
                            </span>
                          </button>
                        </li>
                      ))}
                    </ol>
                    <section aria-label="Payload bytes">
                      <h3 className="hud-label">Payload · text / hex / binary</h3>
                      <ol className="reps mono" data-testid="reps">
                        {reps.map((r) => (
                          <li key={r.byteStart} className="rep">
                            <span className="rep-char">{r.char === ' ' ? '␠' : r.char}</span>
                            <span className="rep-cp">U+{hex(r.codePoint, 4)}</span>
                            <span className="rep-hex">{r.bytes.map((b) => hex(b)).join(' ')}</span>
                            <span className="rep-bin">{r.bytes.map(bin).join(' ')}</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                    <TypedConsole key={`${run.runId}:${lines.join('\n')}`} lines={lines} reduced={reduced} label="Encoding console" />
                    <EventLog events={run.events} selected={selectedEvent} onSelect={selectEvent} />
                  </details>
                </>
              )}
              {tab === 'headers' && (
                <Suspense fallback={<StateView kind="loading" title="Loading headers…" />}><HeaderView
                  snap={snap}
                  selected={selectedField}
                  onSelect={(id) => {
                    setSelectedField(id);
                    setSelectedEvent(null);
                    setShowSel(false);
                    openInspector();
                  }}
                /></Suspense>
              )}
              {tab === 'scopes' && (
                <StateView kind="empty" title="Delivery scopes are overlays on the journey">
                  Open the Journey tab and switch Process ↔ process, Host ↔ host or Hop ↔ hop while stepping through events.
                </StateView>
              )}
              {tab === 'compare' && (
                <Suspense fallback={<StateView kind="loading" title="Loading compare…" />}>
                  <CompareView base={run.config} reduced={reduced} />
                </Suspense>
              )}
              {tab === 'practice' && (
                <Suspense fallback={<StateView kind="loading" title="Loading practice…" />}>
                  <PracticeView key={practiceKey} />
                </Suspense>
              )}
            </div>
          </div>
        </section>

        <aside
          id="inspector"
          ref={inspector}
          tabIndex={-1}
          className={`inspector glass hud-enter${drawer ? ' drawer' : ''}${drawerOpen ? ' open' : ''}`}
          aria-label="Inspector"
          inert={drawer && !drawerOpen}
        >
          <div className="inspector-head">
            <HudLabel>Inspector</HudLabel>
            {drawer && (
              <button type="button" className="btn btn-icon" aria-label="Close inspector" onClick={() => setDrawerOpen(false)}>
                ✕
              </button>
            )}
          </div>
          {!showSel && evSnap && selectedEvent !== null ? (
            <SnapshotDetail s={evSnap} tag={run.events[selectedEvent]?.tag ?? ''} />
          ) : !showSel && selField ? (
            <Suspense fallback={null}><FieldDetail f={selField} /></Suspense>
          ) : sel.kind === 'device' ? (
            <DeviceDetail t={run.template} id={sel.id} />
          ) : (
            <>
              {beat && beat.fields.length > 0 && (
                <section aria-label="Key fields" className="story-fields">
                  <HudLabel>Key fields · this beat</HudLabel>
                  <dl className="facts mono" data-testid="story-fields">
                    {beat.fields.map((id) => {
                      const f = field(snap, id);
                      return f ? (
                        <div key={id} style={{ display: 'contents' }} data-field={id}>
                          <dt className={pulse.ids.includes(id) ? 'hot pulse' : 'hot'} key={`${id}:${pulse.n}`}>{f.name}</dt>
                          <dd className="hot">{f.display}</dd>
                        </div>
                      ) : null;
                    })}
                  </dl>
                </section>
              )}
              <h2 className="layer-title" style={{ color: `var(--c-${selected})` }}>
                <LayerGlyph layer={selected} size={22} /> {LAYERS[selected].name}
              </h2>
              <dl className="facts mono">
                <dt>Code</dt>
                <dd>{LAYERS[selected].code}</dd>
                <dt>Unit</dt>
                <dd>{selected === 'transport' ? (runProto === 'TCP' ? 'segment' : 'datagram') : LAYERS[selected].pdu}</dd>
                <dt>Size</dt>
                <dd>{unitLen(selected)} B</dd>
              </dl>
              <HudLabel>Fields</HudLabel>
              <ul className="fields mono">
                {snap.fields
                  .filter((f) => f.layer === selected)
                  .map((f) => (
                    <li key={`${f.id}:${pulse.n}`} className={pulse.ids.includes(f.id) ? 'pulse' : undefined} data-field-id={f.id}>
                      {f.name}: <span className="mono">{f.display}</span>
                    </li>
                  ))}
              </ul>
              <p className="small muted">Open the Headers tab and select a field to see its bits and bytes.</p>
            </>
          )}
          <Suspense fallback={null}>
            <TutorPanel
              run={run}
              step={journeyIndex}
              layer={sel.kind === 'layer' ? selected : null}
              field={selField ?? null}
              aiConfigured={ai === 'online'}
              reduced={reduced}
              onPulse={(ids) => setPulse((p) => ({ ids, n: p.n + 1 }))}
            />
          </Suspense>
          <HudLabel>System</HudLabel>
          <dl className="facts mono">
            <dt>AI tutor</dt>
            <dd data-testid="ai-status">
              {{ checking: 'checking…', online: 'online', unconfigured: 'server up · AI not configured', offline: 'offline · core app unaffected' }[ai]}
            </dd>
            <dt>Motion</dt>
            <dd>{motion}</dd>
          </dl>
        </aside>
      </main>

      <footer className="dock glass hud-enter" aria-label="Timeline">
        <div className="seg" role="group" aria-label="Playback">
          <button type="button" aria-label="Rewind to start" onClick={resetPlayback}>⏮</button>
          <button type="button" aria-label="Back one event" onClick={() => seekEvent(journeyIndex - 1)}>◀</button>
          <button type="button" aria-label={clockUi.playing ? 'Pause' : 'Play'} aria-pressed={clockUi.playing} data-testid="play" onClick={play}>
            {clockUi.playing ? '⏸' : '▶'}
          </button>
          <button type="button" aria-label="Forward one event" onClick={() => seekEvent(journeyIndex + 1)}>▶|</button>
        </div>
        <Segmented
          label="Speed"
          value={String(clockUi.speed)}
          onChange={(v) => mo.clock.setSpeed(Number(v) as Speed)}
          options={SPEEDS.map((x) => ({ value: String(x), label: `${x}×` }))}
        />
        <input
          ref={scrubRef}
          type="range"
          className="scrub"
          aria-label="Timeline position"
          aria-valuetext={curEv ? `Event ${journeyIndex + 1} of ${run.events.length}: ${curEv.tag}` : ''}
          min={0}
          max={spanOf(cues)}
          step={0.001}
          defaultValue={spanOf(cues)}
          data-testid="scrub"
          onChange={(e) => {
            mo.clock.pause();
            mo.clock.seek(Number(e.target.value));
          }}
        />
        <span className="hud-label" data-testid="dock-status">
          <span ref={tsRef} data-testid="timestamp" className="unit" /> · <span ref={holdRef} data-testid="hold" /> · {run.events.length} events · virtual end{' '}
          <span className="unit">{fmtTime(snap.end?.atMs ?? 0)}</span> · SIMULATED
          {hiddenPause && (
            <strong className="hidden-pause" data-testid="hidden-pause">
              {' '}
              · Paused: tab was hidden
            </strong>
          )}
        </span>
      </footer>

      <RunSummary run={run} connection={ses ? conn : undefined} />

      <dialog ref={help} className="help glass" aria-labelledby="help-title">
        <h2 id="help-title">Help</h2>
        <ul>
          <li>Story asks one question at a time. Lab exposes every current control. Director auto-advances a preset; Space pauses, arrows step and Esc exits.</li>
          <li>The timeline uses presentation time; protocol timestamps and results remain deterministic virtual time.</li>
          <li>Imports contain config, seed and model version only. Events are always regenerated.</li>
          <li>Teaching ISNs, fixed RTO, link timing, prepopulated ARP caches and all faults are SIMULATED.</li>
          <li>Congestion control, SACK, TCP options, IPv6, fragmentation, NAT, TLS, ARP exchange and ICMP generation are NOT BUILT.</li>
          <li>No real sockets, packet capture or measured performance. AI is optional and never supplies protocol facts.</li>
        </ul>
        <form method="dialog">
          <button className="btn btn-primary" autoFocus>
            Close
          </button>
        </form>
      </dialog>
    </div>
    </MotionContext.Provider>
  );
}
