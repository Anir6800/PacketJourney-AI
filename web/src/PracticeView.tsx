import { useMemo, useState } from 'react';
import { buildQuestions, grade, loadProgress, saveProgress, type Progress, type Question } from './practice/questions.ts';

// Practice: type an answer, submit, then see the result and the evidence fields. Answers stay hidden until submitted.

function Item({ q, n, done, onSubmit }: { q: Question; n: number; done: Progress[string] | undefined; onSubmit: (input: string) => void }) {
  const [input, setInput] = useState('');
  return (
    <li className="practice-q" data-testid={`q-${q.id}`} data-state={done ? (done.correct ? 'correct' : 'wrong') : 'open'}>
      <p>
        <strong>{n}.</strong> {q.prompt}
      </p>
      {done ? (
        <div className="practice-reveal" data-testid={`reveal-${q.id}`}>
          <p className={done.correct ? 'ok' : 'field-error'}>
            {done.correct ? '✓ Correct' : '✕ Not quite'} · you answered <span className="mono">{done.input}</span> · answer <span className="mono">{q.answer}</span>
          </p>
          <p className="small">{q.explanation}</p>
          <dl className="facts mono small" aria-label="Evidence from the engine">
            {q.evidence.map((e, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <dt className="hot">{e.label}</dt>
                <dd className="hot">{e.value}</dd>
              </div>
            ))}
          </dl>
          <p className="small muted">Evidence event: {q.eventTag} (SIMULATED fixture run)</p>
        </div>
      ) : (
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) onSubmit(input);
          }}
        >
          <label className="sr-only" htmlFor={`a-${q.id}`}>
            Answer {n}
          </label>
          <input id={`a-${q.id}`} className="field mono" value={input} onChange={(e) => setInput(e.target.value)} placeholder={q.kind === 'yesno' ? 'yes / no' : q.kind === 'number' ? 'number' : 'answer'} />
          <button type="submit" className="btn" disabled={!input.trim()}>
            Submit
          </button>
        </form>
      )}
    </li>
  );
}

export function PracticeView() {
  const qs = useMemo(() => buildQuestions(), []);
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const [round, setRound] = useState(0);
  const update = (p: Progress) => {
    setProgress(p);
    saveProgress(p);
  };
  const correct = Object.values(progress).filter((p) => p.correct).length;
  return (
    <section className="practice" aria-label="Practice" data-testid="practice">
      <div className="row">
        <p className="small" data-testid="practice-score">
          {Object.keys(progress).length} / {qs.length} answered · {correct} correct · graded deterministically from engine runs (no AI)
        </p>
        <button
          type="button"
          className="btn"
          data-testid="practice-reset"
          onClick={() => {
            update({});
            setRound((r) => r + 1);
          }}
        >
          Reset practice
        </button>
      </div>
      <ol className="practice-list" key={round}>
        {qs.map((q, i) => (
          <Item key={q.id} q={q} n={i + 1} done={progress[q.id]} onSubmit={(input) => update({ ...progress, [q.id]: { input: input.trim(), correct: grade(q, input) } })} />
        ))}
      </ol>
      <p className="small muted">Progress is stored only in this browser (local storage) and works offline.</p>
    </section>
  );
}
