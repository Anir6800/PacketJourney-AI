import { useEffect, useRef, useState } from 'react';

// Types lines at `cps` chars/sec. Enter or click completes the current line.
// Screen readers get each finished line once via a role=log region (never per character).
// Parent should `key` this component by its lines to restart it.
export function TypedConsole({ lines, cps = 55, reduced, label, instant = false, paused = false, onDone, testId = 'console' }: {
  lines: readonly string[];
  cps?: number;
  reduced: boolean;
  label: string;
  /** Show everything now (e.g. the learner pressed Space). */
  instant?: boolean;
  /** Freeze the current character for Director pause. */
  paused?: boolean;
  onDone?: () => void;
  testId?: string;
}) {
  const [line, setLine] = useState(0);
  const [chars, setChars] = useState(0);
  const done = reduced || instant || line >= lines.length;
  const current = lines[line] ?? '';

  useEffect(() => {
    if (done || paused) return;
    const t =
      chars >= current.length
        ? setTimeout(() => {
            setLine((l) => l + 1);
            setChars(0);
          }, 220)
        : setTimeout(() => setChars((c) => c + 1), 1000 / cps);
    return () => clearTimeout(t);
  }, [done, paused, chars, current.length, cps]);

  const doneRef = useRef(onDone);
  useEffect(() => {
    doneRef.current = onDone;
  });
  useEffect(() => {
    if (done) doneRef.current?.();
  }, [done]);

  const complete = () => {
    if (done) return;
    setLine((l) => l + 1);
    setChars(0);
  };

  const finished = done ? lines : lines.slice(0, line);

  return (
    <div
      className="console"
      tabIndex={0}
      role="region"
      aria-label={`${label}. Press Enter to complete the current line.`}
      data-testid={testId}
      data-done={done ? '' : undefined}
      onClick={complete}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          complete();
        }
      }}
    >
      <div aria-hidden="true">
        {finished.map((l, i) => (
          <p key={i}>
            <span className="prompt">›</span> {l}
          </p>
        ))}
        {!done && (
          <p>
            <span className="prompt">›</span> {current.slice(0, chars)}
            <span className="caret" />
          </p>
        )}
      </div>
      <div className="sr-only" role="log" aria-live="polite" data-testid={`${testId}-log`}>
        {finished.map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    </div>
  );
}
