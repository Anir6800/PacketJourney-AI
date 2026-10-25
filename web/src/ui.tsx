import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

export function Segmented<T extends string>(props: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg" role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button type="button" key={o.value} aria-pressed={props.value === o.value} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function HudLabel({ children }: { children: ReactNode }) {
  return <span className="hud-label">{children}</span>;
}

export function StateView({ kind, title, children }: { kind: 'empty' | 'loading' | 'error'; title: string; children?: ReactNode }) {
  return (
    <div className={`state state-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="state-icon" aria-hidden="true">
        {{ empty: '◌', loading: '◔', error: '✕' }[kind]}
      </span>
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Tabs<T extends string>(props: {
  label: string;
  tabs: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState({ x: 0, y: 0, w: 0 });

  // Underline morphs between tabs (CSS transition on transform/width; instant under Reduced).
  useLayoutEffect(() => {
    const measure = () => {
      const el = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      // Tabs may wrap on narrow screens, so track the row too.
      if (el) setBar({ x: el.offsetLeft, y: el.offsetTop + el.offsetHeight - 4, w: el.offsetWidth });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [props.value]);

  const onKey = (e: React.KeyboardEvent, i: number) => {
    const n = props.tabs.length;
    const next = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const t = props.tabs[next];
    if (!t) return;
    props.onChange(t.id);
    list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div className="tabs" role="tablist" aria-label={props.label} ref={list}>
      {props.tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-controls={`panel-${t.id}`}
          aria-selected={props.value === t.id}
          tabIndex={props.value === t.id ? 0 : -1}
          onClick={() => props.onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
      <span className="tab-bar" aria-hidden="true" style={{ transform: `translate(${bar.x}px, ${bar.y}px)`, width: bar.w }} />
    </div>
  );
}

export function useMediaQuery(q: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(q);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(q).matches,
  );
}
