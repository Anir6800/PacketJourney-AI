import { useRef, useState } from 'react';
import { checkPayload, utf8 } from '@packetjourney/shared';
import { gsap, useGSAP } from './gsap.ts';
import { debug } from './debug.ts';

export function MessageEntry({ value, onChange, onEnter, onDirector, directorMessage, reduced }: {
  value: string; onChange: (value: string) => void; onEnter: () => void; onDirector: () => void; directorMessage: string; reduced: boolean;
}) {
  const [tried, setTried] = useState(false);
  const [directorTyping, setDirectorTyping] = useState(false);
  const scope = useRef<HTMLElement>(null);
  useGSAP(() => {
    if (!directorTyping) return;
    const count = { n: 0 };
    gsap.to(count, { n: directorMessage.length, duration: Math.min(1.2, directorMessage.length * 0.08), ease: 'none',
      onUpdate: () => onChange(directorMessage.slice(0, Math.ceil(count.n))), onComplete: onDirector });
  }, { scope, dependencies: [directorTyping], revertOnUpdate: true });
  const bytes = utf8(value).length;
  const issue = checkPayload(value);
  return (
    <main className="intro intro-entry" data-testid="message-entry" ref={scope}
      onKeyDown={(e) => { if (e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); if (reduced) onDirector(); else setDirectorTyping(true); } }}>
      <form className="entry-form" onSubmit={(e) => { e.preventDefault(); if (!issue.ok) setTried(true); else onEnter(); }}>
        <label className="sr-only" htmlFor="entry-message">Message to send</label>
        <input id="entry-message" className="entry-input glass" placeholder="Enter a message" value={value} autoFocus disabled={directorTyping}
          aria-invalid={tried && !issue.ok} aria-describedby="entry-count entry-error"
          onChange={(e) => onChange(e.target.value)} />
        <p id="entry-count" className="entry-count mono" data-testid="entry-count">{bytes} / 256 bytes UTF-8</p>
        {tried && !issue.ok && <p id="entry-error" className="entry-error" role="alert">✕ {issue.error}</p>}
      </form>
      <span className="intro-tag mono">SIMULATED · local</span>
    </main>
  );
}

export function RunBoot({ lines, onComplete }: { lines: string[]; onComplete: () => void }) {
  const scope = useRef<HTMLElement>(null);
  useGSAP(() => {
    const done = () => { debug.bootCompletions += 1; onComplete(); };
    const tl = gsap.timeline({ onComplete: done });
    tl.from('.boot-line', { opacity: 0, clipPath: 'inset(0 100% 0 0)', duration: 0.4, stagger: 0.32, ease: 'power4.out' }, 0)
      .fromTo('.boot-progress', { scaleX: 0 }, { scaleX: 1, duration: 2.8, ease: 'none' }, 0);
    const skip = () => tl.progress(1);
    // Attach after the Enter that mounted this screen has finished bubbling.
    const attach = window.setTimeout(() => {
      window.addEventListener('keydown', skip);
      window.addEventListener('pointerdown', skip);
    }, 0);
    return () => { window.clearTimeout(attach); window.removeEventListener('keydown', skip); window.removeEventListener('pointerdown', skip); };
  }, { scope });
  return (
    <main className="intro intro-boot" data-testid="run-boot" ref={scope}>
      <div className="boot-lines mono" aria-live="off">
        {lines.map((line, index) => <p key={index} className="boot-line">{line}</p>)}
        <p className="boot-line">SIMULATED run ready</p>
        <div className="boot-track"><div className="boot-progress" /></div>
      </div>
    </main>
  );
}
