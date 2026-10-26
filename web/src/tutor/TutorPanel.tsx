import { useEffect, useRef, useState } from 'react';
import type { ExplainResponse, Field, SimRun } from '@packetjourney/shared';
import { TypedConsole } from '../TypedConsole.tsx';
import { HudLabel } from '../ui.tsx';
import { TutorClient, buildRequest, builtIn, type TutorKind } from './tutor.ts';

type Layer = 'app' | 'transport' | 'internet' | 'link' | 'physical';
type Props = {
  run: SimRun;
  step: number;
  layer: Layer | null;
  field: Field | null;
  aiConfigured: boolean;
  reduced: boolean;
  onPulse: (ids: string[]) => void;
};

const ERRORS: Record<string, string> = {
  timeout: 'Live AI timed out',
  'rate-limited': 'Live AI is rate-limited right now',
  malformed: 'Live AI returned an answer that failed validation',
  upstream: 'The AI provider returned an error',
  'ai-not-configured': 'No AI provider is configured on the server',
  network: 'The local AI server is not reachable',
};

/** Tutor: built-in explanations by default; live AI only after an explicit opt-in. Answers are plain text. */
export function TutorPanel({ run, step, layer, field, aiConfigured, reduced, onPulse }: Props) {
  const [client] = useState(() => new TutorClient());
  const [live, setLive] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [answer, setAnswer] = useState<(ExplainResponse & { n: number }) | null>(null);
  const n = useRef(0);

  // A new selection cancels any pending live request (its answer could no longer match what is shown).
  const selKey = `${step}|${layer}|${field?.id ?? ''}`;
  const [lastSel, setLastSel] = useState(selKey);
  if (selKey !== lastSel) {
    setLastSel(selKey);
    setBusy(false);
  }
  useEffect(() => client.cancel(), [client, selKey]);
  useEffect(() => () => client.cancel(), [client]);

  const show = (res: ExplainResponse, note = '') => {
    setAnswer({ ...res, n: ++n.current });
    setStatus(note);
    onPulse(res.refs);
  };

  const ask = (kind: TutorKind) => {
    const req = buildRequest({ kind, run, step, layer, field, question });
    if (!live || !aiConfigured) return show(builtIn(req, run));
    setBusy(true);
    setStatus('Asking live AI…');
    void client.ask(req, ({ res, err }) => {
      setBusy(false);
      if (res) return show(res);
      // Keep the selected context: fall back to the built-in answer with a visible status.
      show(builtIn(req, run), `${ERRORS[err?.code ?? ''] ?? 'Live AI failed'}${err?.status ? ` (HTTP ${err.status})` : ''}; showing the built-in explanation.`);
    });
  };

  const label = !answer ? '' : answer.source === 'built-in' ? 'Built-in explanation' : answer.grounding === 'verified' ? 'Live AI · grounded in the supplied facts' : 'Live AI · generated (not fully verified, check the field panel)';
  const lines = answer ? [...answer.explanation.split('\n').filter(Boolean), ...answer.caveats.map((c) => `Note: ${c}`)] : [];

  return (
    <section className="tutor" aria-label="Tutor" data-testid="tutor">
      <HudLabel>Tutor</HudLabel>
      <div className="tutor-buttons">
        <button type="button" className="btn" onClick={() => ask('layer')} disabled={busy || !layer}>
          Explain layer
        </button>
        <button type="button" className="btn" onClick={() => ask('field')} disabled={busy || !field}>
          Explain field
        </button>
        <button type="button" className="btn" onClick={() => ask('why')} disabled={busy}>
          Why did this happen
        </button>
        <button type="button" className="btn" onClick={() => ask('compare')} disabled={busy}>
          TCP vs UDP
        </button>
      </div>
      <label htmlFor="tutor-q" className="small">
        Optional question (sent only with live AI)
      </label>
      <input id="tutor-q" className="field" maxLength={300} value={question} onChange={(e) => setQuestion(e.target.value)} />
      <label className="check small">
        <input type="checkbox" checked={live} disabled={!aiConfigured} onChange={(e) => setLive(e.target.checked)} data-testid="tutor-live" /> Use live AI
      </label>
      <p className="small muted" data-testid="tutor-consent">
        {aiConfigured
          ? 'Live AI sends the selected context (event text, this layer’s field values, TCP states and your question) to the AI provider configured on the local server, which is a cloud service. Nothing is sent until you tick this box and press a button; no background uploads.'
          : 'No AI provider is configured on the server, so explanations are built in and stay on this computer.'}
      </p>
      {status && (
        <p className="small tutor-status" role="status" data-testid="tutor-status">
          {status}
        </p>
      )}
      {answer && (
        <>
          <p className="hud-label" data-testid="tutor-source">
            {label}
          </p>
          {/* Typed only after the whole answer arrived and was validated; plain text only (no HTML). */}
          <TypedConsole key={answer.n} lines={lines} cps={50} reduced={reduced} label="Tutor answer" testId="tutor-answer" />
          {answer.refs.length > 0 && (
            <p className="small mono muted" data-testid="tutor-refs">
              References: {answer.refs.join(', ')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
