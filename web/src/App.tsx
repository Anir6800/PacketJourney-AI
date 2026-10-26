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
  validateSimConfig,
  bin,
  type CookieChoice,
  type HealthResponse,
  type HttpSessionRun,
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
import { hasWebGL, type Motion, type View } from './settings.ts';
import { useBoot } from './useBoot.ts';
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

const JourneyStage3D = lazy(() => import('./JourneyStage3D.tsx'));
// Lab-only UI loads on demand: Story Mode is the first-run default (keeps the initial bundle within budget).
const ConfigForm = lazy(() => import('./ConfigForm.tsx').then((m) => ({ default: m.ConfigForm })));
const HeaderView = lazy(() => import('./HeaderView.tsx').then((m) => ({ default: m.HeaderView })));
const FieldDetail = lazy(() => import('./HeaderView.tsx').then((m) => ({ default: m.FieldDetail })));
const SessionPanel = lazy(() => import('./SessionPanel.tsx').then((m) => ({ default: m.SessionPanel })));
const CompareView = lazy(() => import('./CompareView.tsx').then((m) => ({ default: m.CompareView })));
const PracticeView = lazy(() => import('./PracticeView.tsx').then((m) => ({ default: m.PracticeView })));
const FaultEditor = lazy(() => import('./faults/FaultEditor.tsx').then((m) => ({ default: m.FaultEditor })));

type Ai = 'checking' | 'online' | 'unconfigured' | 'offline';
type Mode = 'story' | 'lab';
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
  const [motionPref, setMotion] = useState<Motion | null>(null);
  const motion: Motion = motionPref ?? (osReduced ? 'reduced' : 'cinematic');
  const reduced = motion === 'reduced';

  // Story Mode is the first-run default; the choice and story progress persist for the session (resumable).
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return sessionStorage.getItem('pj.mode') === 'lab' ? 'lab' : 'story';
    } catch {
      return 'story';
    }
  });
  const [story, setStory] = useState<StoryState>(loadStory);
  const [view, setView] = useState<View>('3d');
  const [contextLost, setContextLost] = useState(false);
  const [tab, setTab] = useState<Tab>('journey');
  const [ai, setAi] = useState<Ai>('checking');
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
  const booting = useBoot(root, reduced, WORDMARK);

  useEffect(() => {
    document.documentElement.dataset.motion = motion;
  }, [motion]);

  useEffect(() => {
    const sync = () => {
      document.documentElement.dataset.hidden = String(document.hidden);
      setDocHidden(document.hidden);
      // A hidden tab pauses playback, with a visible note in the dock.
      if (document.hidden && mo.clock.state.playing) {
        mo.clock.pause();
        setHiddenPause(true);
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [mo]);

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

  const startRun = () => {
    if (issues.length) return;
    if (draft.payloadMode === 'http') {
      const a = controller.start(httpSessionConfigs(draft).a);
      setRun(a);
      setSes({ s: continueHttpSession(a, draft, cookieB), base: structuredClone(draft), cookieB });
      setConn('a');
    } else {
      setRun(controller.start(draft));
      setSes(null);
    }
    setSelectedEvent(null);
    setSelectedField(null);
  };
  const resetDraft = () => {
    setDraft(structuredClone(ses ? ses.base : latest.config));
    if (ses) setCookieB(ses.cookieB);
  };
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

  // Built only while a story plays (it re-runs the engine for its predictions): keeps first load and Lab light.
  const storyPlaying = mode === 'story' && story.phase === 'play';
  const beats = useMemo(() => (storyPlaying ? buildStory(run) : []), [run, storyPlaying]);
  const beat = mode === 'story' && story.phase === 'play' ? beats[Math.min(story.beat, beats.length - 1)] : undefined;
  useEffect(() => {
    if (import.meta.env.DEV || import.meta.env.MODE === 'test') debug.story = () => beats.map((b) => ({ id: b.id, chapter: b.chapter, kind: b.kind, layer: b.layer, text: [b.title, ...b.lines] }));
  }, [beats]);
  const startStory = () => {
    if (validateSimConfig(draft).length) return false;
    startRun();
    setStory((st) => ({ ...st, phase: 'play', beat: 0, config: structuredClone(draft) }));
    return true;
  };
  const replayAsStory = () => {
    setStory((st) => ({ ...INITIAL_STORY, auto: st.auto, phase: 'play', config: structuredClone(run.config) }));
    setMode('story');
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

  return (
    <MotionContext.Provider value={mo}>
    <div className="app" ref={root} onKeyDown={(e) => e.key === 'Escape' && drawerOpen && setDrawerOpen(false)}>
      <p className="sr-only" aria-live="polite" data-testid="announcer">
        {curEv ? `Step ${journeyIndex + 1}: ${curEv.tag}. ${explain(curEv)}` : ''}
      </p>
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
          <Segmented label="Mode" value={mode} onChange={setMode} options={[{ value: 'story', label: 'Story' }, { value: 'lab', label: 'Lab' }]} />
          <Segmented label="Protocol" value={proto} onChange={setProto} options={[{ value: 'TCP', label: 'TCP' }, { value: 'UDP', label: 'UDP' }]} />
          <Segmented label="Motion" value={motion} onChange={setMotion} options={[{ value: 'cinematic', label: 'Cinematic' }, { value: 'reduced', label: 'Reduced' }]} />
          <Segmented label="View" value={view} onChange={setView} options={[{ value: '3d', label: '3D' }, { value: '2d', label: '2D' }]} />
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
        <aside className={`rail glass hud-enter${mode === 'story' ? ' rail-story' : ''}`} aria-label={mode === 'story' ? 'Story' : 'Configuration'}>
          <HudLabel>{mode === 'story' ? 'Story Mode' : 'Lab Mode'}</HudLabel>
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
          ) : (
            <>
          <Suspense fallback={<StateView kind="loading" title="Loading Lab controls…" />}>
          <p className="muted small">Free lab: every setting below. The story's answers live here too.</p>
          <button type="button" className="btn" data-testid="replay-story" onClick={replayAsStory}>
            Replay this run as a story
          </button>
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
                  <div className="viewport">
                    {webglWanted && (
                      <div className="viewport-3d" hidden={contextLost}>
                        <Suspense fallback={<Stage2D reason="Loading 3D stage… the 2D journey below is ready" />}>
                          <JourneyStage3D
                            model={model}
                            selected={sel}
                            onSelect={pick}
                            reduced={reduced}
                            playing={clockUi.playing}
                            motion={mo}
                            rig={beat?.rig}
                            hidden={docHidden || contextLost}
                            onContextLost={() => setContextLost(true)}
                            onContextRestored={() => setContextLost(false)}
                          />
                        </Suspense>
                      </div>
                    )}
                    {!webgl && <Stage2D reason={fallbackReason} />}
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
                  <PracticeView />
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
                          <dt className="hot">{f.name}</dt>
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
                    <li key={f.id}>{f.name}</li>
                  ))}
              </ul>
              <p className="small muted">Open the Headers tab and select a field to see its bits and bytes.</p>
            </>
          )}
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

      <dialog ref={help} className="help glass" aria-labelledby="help-title">
        <h2 id="help-title">Help</h2>
        <ul>
          <li>Any key or click skips the intro (plays once per session).</li>
          <li>← / → move between stage tabs.</li>
          <li>Enter or click completes the current console line.</li>
          <li>Headers tab: select a field to highlight its exact bytes.</li>
          <li>Esc closes this dialog and the inspector drawer.</li>
          <li>Everything shown is SIMULATED; no real network traffic.</li>
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
