import { useState, type RefObject } from 'react';
import { gsap, useGSAP } from './gsap.ts';
import { dur, ease } from './tokens.ts';
import { debug } from './debug.ts';

const KEY = 'pj.booted';

function readBooted(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

// Boot intro: ≤ 2.5 s, skippable by any key/click, once per session, skipped entirely under Reduced.
// The decision is made once in useState, and sessionStorage is written only on completion, so the
// StrictMode mount→revert→mount cycle restarts the same timeline instead of playing it twice.
/** Returns true while the intro is playing (callers defer heavy work, e.g. the 3D chunk, until it ends). */
export function useBoot(scope: RefObject<HTMLElement | null>, reduced: boolean, wordmark: string): boolean {
  const [play] = useState(() => !reduced && !readBooted());
  const [running, setRunning] = useState(play);

  useGSAP(
    () => {
      if (!play) return;
      const skip = () => tl.progress(1);
      const detach = () => {
        window.removeEventListener('keydown', skip);
        window.removeEventListener('pointerdown', skip);
      };
      const tl = gsap.timeline({
        onComplete: () => {
          detach();
          try {
            sessionStorage.setItem(KEY, '1');
          } catch {
            // storage blocked: intro may replay next load, harmless
          }
          debug.bootCompletions += 1;
          setRunning(false);
        },
      });
      tl.from('.grid-bg', { opacity: 0, duration: 0.5, ease: 'none' })
        .to('.wordmark-text', { duration: 1, scrambleText: { text: wordmark, chars: '01<>/{}#', speed: 0.6 } }, 0.2)
        .from('.hud-enter', { opacity: 0, y: 12, duration: 0.4, ease: ease.out, stagger: dur.stagger }, 0.6)
        .from('.badge-sim', { opacity: 0, scale: 1.4, duration: 0.5, ease: 'back.out(2)' }, 1.6);
      window.addEventListener('keydown', skip);
      window.addEventListener('pointerdown', skip);
      return detach;
    },
    { scope },
  );
  return running;
}
