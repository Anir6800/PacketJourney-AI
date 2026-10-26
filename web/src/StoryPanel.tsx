import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PAYLOAD_MAX, checkPayload, templateEndpoints, utf8, type SimConfig, type TemplateId } from '@packetjourney/shared';
import { TypedConsole } from './TypedConsole.tsx';
import { HudLabel } from './ui.tsx';
import { AUTO_HOLD_MS, CHAPTERS, STORY_CPS, type Beat } from './story/script.ts';
import { INITIAL_STORY, PROMPT, faultOf, questionsFor, validate, withFault, type FaultChoice, type QuestionId, type StoryState } from './story/questions.ts';

type Props = {
  draft: SimConfig;
  setDraft: (f: (d: SimConfig) => SimConfig) => void;
  beats: Beat[];
  story: StoryState;
  setStory: (f: (s: StoryState) => StoryState) => void;
  reduced: boolean;
  /** Runs the draft and starts the story; returns false when the config is not runnable. */
  onStart: () => boolean;
  onPractice: () => void;
};

const toPort = (v: string) => (v.replace(/\D/g, '') === '' ? Number.NaN : Number(v.replace(/\D/g, '')));

/** Guided Story Mode: one question at a time, then one beat at a time. */
export function StoryPanel(p: Props) {
  return p.story.phase === 'ask' ? <Questions {...p} /> : <Player {...p} />;
}

function Choice<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; title: string; line: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="story-cards" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className="story-card" data-testid={`choice-${o.value}`} onClick={() => onChange(o.value)}>
          <strong>{o.title}</strong>
          <span className="small muted">{o.line}</span>
        </button>
      ))}
    </div>
  );
}

function Questions({ draft, setDraft, story, setStory, reduced, onStart }: Props) {
  const qs = questionsFor(draft);
  const qi = Math.min(story.q, qs.length - 1);
  const q = qs[qi] ?? 'message';
  return <Question key={q} q={q} qi={qi} total={qs.length} draft={draft} setDraft={setDraft} setStory={setStory} reduced={reduced} onStart={onStart} />;
}

function Question({ q, qi, total, draft, setDraft, setStory, reduced, onStart }: {
  q: QuestionId; qi: number; total: number; draft: SimConfig; setDraft: Props['setDraft']; setStory: Props['setStory']; reduced: boolean; onStart: () => boolean;
}) {
  const [typed, setTyped] = useState(false);
  const [instant, setInstant] = useState(false);
  const [tried, setTried] = useState(false);
  const [startError, setStartError] = useState('');
  const issues = validate(q, draft);
  const err = (f: string) => (tried ? issues.find((i) => i.field === f)?.message : undefined);
  const setPort = (side: 'client' | 'server', v: number) =>
    setDraft((d) => ({
      ...d,
      endpoints: { ...d.endpoints, [side]: { ...d.endpoints[side], port: v } },
      ...(side === 'server' ? { requestDstPort: v } : {}),
    }));

  const next = () => {
    if (!typed) return setInstant(true);
    if (issues.length) return setTried(true);
    if (q === 'confirm') {
      if (!onStart()) setStartError('This configuration cannot run yet. Go back and check the answers.');
      return;
    }
    setStory((s) => ({ ...s, q: qi + 1 }));
  };
  const back = () => setStory((s) => ({ ...s, q: Math.max(0, qi - 1) }));
  const bytes = checkPayload(draft.request);
  const tcp = draft.protocol === 'TCP';

  let control: ReactNode;
  if (q === 'message') {
    control = (
      <>
        <label htmlFor="story-msg">Message</label>
        <input id="story-msg" className="field mono" value={draft.request} aria-invalid={Boolean(err('request'))} aria-describedby="story-msg-count"
          onChange={(e) => setDraft((d) => ({ ...d, request: e.target.value }))} autoFocus />
        <p id="story-msg-count" className="small mono muted" data-testid="story-bytes">
          {utf8(draft.request).length} / {PAYLOAD_MAX} bytes UTF-8 · {[...draft.request].length} characters
        </p>
        {!bytes.ok && tried && <p className="field-error" role="alert">✕ {bytes.error}</p>}
      </>
    );
  } else if (q === 'transport') {
    control = (
      <Choice label="Transport" value={draft.protocol} onChange={(v) => setDraft((d) => ({ ...d, protocol: v, payloadMode: v === 'UDP' ? 'raw' : d.payloadMode }))} options={[
        { value: 'TCP', title: 'TCP', line: 'A connection: handshake, sequence numbers and ACKs; lost data is retransmitted.' },
        { value: 'UDP', title: 'UDP', line: 'No connection and no ACKs: each datagram is sent once and loss is not repaired.' },
      ]} />
    );
  } else if (q === 'ports') {
    control = (
      <>
        <label htmlFor="story-cport">Client source port</label>
        <input id="story-cport" className="field mono" inputMode="numeric" value={Number.isNaN(draft.endpoints.client.port) ? '' : String(draft.endpoints.client.port)}
          aria-invalid={Boolean(err('client.port'))} onChange={(e) => setPort('client', toPort(e.target.value))} />
        {err('client.port') && <p className="field-error" role="alert">✕ {err('client.port')}</p>}
        <label htmlFor="story-sport">Server application port</label>
        <input id="story-sport" className="field mono" inputMode="numeric" value={Number.isNaN(draft.endpoints.server.port) ? '' : String(draft.endpoints.server.port)}
          aria-invalid={Boolean(err('server.port'))} onChange={(e) => setPort('server', toPort(e.target.value))} />
        {err('server.port') && <p className="field-error" role="alert">✕ {err('server.port')}</p>}
        <p className="small muted">Defaults: an ephemeral client port and the demo echo service port. Any 1–65535, different from each other.</p>
      </>
    );
  } else if (q === 'scope') {
    control = (
      <Choice label="Network" value={draft.template} onChange={(t: TemplateId) => setDraft((d) => ({ ...d, template: t, endpoints: templateEndpoints(t, { client: d.endpoints.client.port, server: d.endpoints.server.port }) }))} options={[
        { value: 'same-lan', title: 'Same network', line: 'One Ethernet link: the frame goes straight to the receiver.' },
        { value: 'routed', title: 'Across routers', line: 'Sender → R1 → R2 → Receiver: three links, two TTL decrements.' },
      ]} />
    );
  } else if (q === 'payload') {
    control = (
      <Choice label="Payload" value={draft.payloadMode} onChange={(v) => setDraft((d) => ({ ...d, payloadMode: v }))} options={[
        { value: 'raw', title: 'Raw message', line: 'Your text exactly as typed, as UTF-8 bytes.' },
        { value: 'http', title: 'HTTP/1.1', line: 'A generated HTTP request and response around a demo session (unencrypted; TLS NOT BUILT).' },
      ]} />
    );
  } else if (q === 'fault') {
    control = (
      <Choice label="Fault" value={faultOf(draft)} onChange={(f: FaultChoice) => setDraft((d) => withFault(d, f))} options={[
        { value: 'none', title: 'No fault', line: 'Every frame arrives.' },
        { value: 'lose-data', title: 'Lose the first data packet once', line: tcp ? 'TCP notices the missing ACK and retransmits after its timer.' : 'UDP never notices: the message is simply not delivered.' },
      ]} />
    );
  } else {
    control = (
      <dl className="facts mono" data-testid="story-summary">
        <dt>Payload</dt>
        <dd>{draft.payloadMode === 'http' ? 'HTTP/1.1 session demo' : `"${draft.request}" · ${utf8(draft.request).length} B`}</dd>
        <dt>Transport</dt>
        <dd>{draft.protocol}</dd>
        <dt>Ports</dt>
        <dd>
          {draft.endpoints.client.port} → {draft.endpoints.server.port}
        </dd>
        <dt>Path</dt>
        <dd>{draft.template === 'routed' ? 'Sender → R1 → R2 → Receiver' : 'same network'}</dd>
        <dt>Fault</dt>
        <dd>{faultOf(draft) === 'none' ? 'none' : 'lose the first data packet once'}</dd>
      </dl>
    );
  }

  return (
    <form className="story" data-testid="story-question" data-q={q} noValidate onSubmit={(e) => { e.preventDefault(); next(); }}>
      <HudLabel>
        Question {qi + 1} of {total}
      </HudLabel>
      <TypedConsole lines={[PROMPT[q]]} cps={STORY_CPS} reduced={reduced} instant={instant} onDone={() => setTyped(true)} label="Story question" testId="story-prompt" />
      {typed && (
        <div className="story-answer" data-testid="story-answer">
          {control}
          {startError && <p className="field-error" role="alert">✕ {startError}</p>}
        </div>
      )}
      <div className="row">
        <button type="button" className="btn" onClick={back} disabled={qi === 0}>
          Back
        </button>
        <button type="submit" className="btn btn-primary" data-testid="story-next">
          {!typed ? 'Show answer options' : q === 'confirm' ? 'Start the story' : 'Next'}
        </button>
      </div>
    </form>
  );
}

function Player({ beats, story, setStory, reduced, onPractice }: Props) {
  const bi = Math.min(story.beat, beats.length - 1);
  const b = beats[bi];
  if (!b) return null;
  return <BeatView key={b.id} b={b} bi={bi} beats={beats} story={story} setStory={setStory} reduced={reduced} onPractice={onPractice} />;
}

function BeatView({ b, bi, beats, story, setStory, reduced, onPractice }: {
  b: Beat; bi: number; beats: Beat[]; story: StoryState; setStory: Props['setStory']; reduced: boolean; onPractice: () => void;
}) {
  const [typed, setTyped] = useState(false);
  const [instant, setInstant] = useState(false);
  const [shown, setShown] = useState<Record<number, boolean>>({});
  const last = bi >= beats.length - 1;
  const go = (i: number) => setStory((s) => ({ ...s, beat: Math.max(0, Math.min(beats.length - 1, i)) }));
  // Mirror of `typed` for the window key handler (state alone can be one render behind there).
  const typedRef = useRef(false);
  const markTyped = () => {
    typedRef.current = true;
    setTyped(true);
  };
  const next = () => {
    if (!typedRef.current) return setInstant(true); // first press completes the typing
    if (!last) go(bi + 1);
  };
  const skip = () => {
    const ci = CHAPTERS.findIndex((c) => c.id === b.chapter);
    const target = beats.findIndex((x) => CHAPTERS.findIndex((c) => c.id === x.chapter) > ci);
    go(target < 0 ? beats.length - 1 : target);
  };
  const keys = useRef({ next, back: () => go(bi - 1) });
  useLayoutEffect(() => {
    keys.current = { next, back: () => go(bi - 1) };
  });

  // Auto-play: advance after the beat has finished typing plus a presentation-only hold.
  useEffect(() => {
    if (!story.auto || !typed || last) return;
    const t = setTimeout(() => go(bi + 1), AUTO_HOLD_MS);
    return () => clearTimeout(t);
  }, [story.auto, typed, last, bi]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: Space / Enter / → next (completing the typing first), ← back. Not inside fields or on buttons.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, button, summary, a, [role="tablist"], [role="button"], dialog[open], .console')) return;
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        keys.current.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        keys.current.back();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const chapterIdx = CHAPTERS.findIndex((c) => c.id === b.chapter);
  return (
    <section className="story" data-testid="story-player" data-beat={b.id} data-chapter={b.chapter} data-kind={b.kind} data-layer={b.layer ?? ''} aria-label="Story">
      <ol className="story-rail" aria-label="Chapters" data-testid="story-rail">
        {CHAPTERS.map((c, i) => {
          const n = beats.filter((x) => x.chapter === c.id).length;
          const done = beats.filter((x, j) => x.chapter === c.id && j < bi).length;
          return (
            <li key={c.id} aria-current={i === chapterIdx ? 'step' : undefined} data-state={i < chapterIdx ? 'done' : i === chapterIdx ? 'current' : 'todo'}>
              <span>{c.label}</span>
              <span className="mono small">
                {i === chapterIdx ? done + 1 : i < chapterIdx ? n : 0}/{n}
              </span>
            </li>
          );
        })}
      </ol>
      <TypedConsole lines={[b.title, ...b.lines]} cps={STORY_CPS} reduced={reduced} instant={instant} onDone={markTyped} label="Story narration" testId="story-caption" />
      {b.predict && typed && (
        <div className="story-predict" data-testid="story-predict">
          {b.predict.map((x, i) => (
            <div key={i}>
              <p>{x.q}</p>
              {shown[i] ? (
                <p className="mono small" data-testid={`predict-answer-${i}`}>
                  {x.a}
                </p>
              ) : (
                <button type="button" className="btn" onClick={() => setShown((s) => ({ ...s, [i]: true }))}>
                  Reveal answer
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn" onClick={onPractice}>
            Open Practice
          </button>
        </div>
      )}
      <div className="row">
        <button type="button" className="btn" onClick={() => go(bi - 1)} disabled={bi === 0}>
          Back
        </button>
        <button type="button" className="btn btn-primary" data-testid="story-beat-next" onClick={next} disabled={typed && last}>
          {!typed ? 'Show all' : last ? 'Story complete' : 'Next'}
        </button>
        <button type="button" className="btn" onClick={skip} disabled={b.chapter === 'recap'}>
          Skip chapter
        </button>
      </div>
      <div className="row">
        <label className="check">
          <input type="checkbox" checked={story.auto} onChange={(e) => setStory((s) => ({ ...s, auto: e.target.checked }))} /> Auto-play
        </label>
        <button type="button" className="btn" onClick={() => setStory((s) => ({ ...INITIAL_STORY, auto: s.auto }))}>
          Restart story
        </button>
      </div>
      <p className="small muted mono" data-testid="story-position">
        Beat {bi + 1} of {beats.length} · typing {STORY_CPS} chars/s · Space/→ next, ← back
      </p>
    </section>
  );
}
