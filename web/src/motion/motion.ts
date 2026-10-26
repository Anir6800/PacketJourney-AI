import { createContext, useContext, type RefObject } from 'react';
import { gsap, useGSAP } from '../gsap.ts';
import { PlaybackClock } from './clock.ts';
import { locate, spanOf, type Cue, type CuePos } from './cues.ts';

// Glue between the one clock, the paused GSAP master timeline and the views.
// GSAP never plays: every clock change calls master.time(pt). 3D reads `pos` through a ref each frame.

export type Motion = {
  clock: PlaybackClock;
  master: gsap.core.Timeline;
  cues: RefObject<Cue[]>;
  pos: RefObject<CuePos>;
  /** Re-renders every child timeline at the clock's current time (after a child is added or rebuilt). */
  sync: () => void;
};

export function createMotion(): Motion {
  const clock = new PlaybackClock(0);
  const master = gsap.timeline({ paused: true });
  const cues: RefObject<Cue[]> = { current: [] };
  const pos: RefObject<CuePos> = { current: { index: -1, progress: 0, vt: 0, cue: null } };
  const sync = () => {
    const t = clock.state.pt;
    // GSAP skips rendering when the time is unchanged, so step away silently and back.
    master.time(t > 0 ? 0 : Math.min(1e-6, master.duration()), true);
    master.time(t);
  };
  return { clock, master, cues, pos, sync };
}

let endMarker: gsap.core.Tween | null = null;

/** Labels per event id + an end marker so the master's duration equals the mapped event span. */
export function setCues(m: Motion, cues: Cue[]) {
  m.cues.current = cues;
  for (const l of Object.keys(m.master.labels)) m.master.removeLabel(l);
  for (const c of cues) m.master.addLabel(c.eventId, c.startPT);
  endMarker?.kill();
  endMarker = gsap.to({}, { duration: 0 });
  m.master.add(endMarker, spanOf(cues));
  m.pos.current = locate(cues, m.clock.state.pt);
}

export const MotionContext = createContext<Motion | null>(null);

export function useMotion(): Motion {
  const m = useContext(MotionContext);
  if (!m) throw new Error('MotionContext missing');
  return m;
}

/**
 * A component's slice of the choreography: a child timeline placed at 0 inside the master, rebuilt when
 * `deps` change and reverted (tweens killed, inline styles restored) on unmount. StrictMode-safe via useGSAP.
 */
export function useMasterChild(build: (tl: gsap.core.Timeline) => void, deps: unknown[], scope: RefObject<HTMLElement | SVGElement | null>) {
  const m = useMotion();
  useGSAP(
    () => {
      const tl = gsap.timeline();
      build(tl);
      m.master.add(tl, 0);
      m.sync();
      return () => {
        m.master.remove(tl);
      };
    },
    { scope, dependencies: deps, revertOnUpdate: true },
  );
}
