import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { SimRun } from '@packetjourney/shared';
import { getFlip } from './gsap.ts';
import { scrambled } from './CueOverlay.tsx';
import type { Cue } from './motion/cues.ts';
import { useMasterChild, type Motion } from './motion/motion.ts';
import type { Beat } from './story/script.ts';

export function Opening({ run, beats, cues, motion, onComplete }: {
  run: SimRun; beats: Beat[]; cues: Cue[]; motion: Motion; onComplete: () => void;
}) {
  const scope = useRef<HTMLElement>(null);
  const complete = useRef(onComplete);
  useLayoutEffect(() => { complete.current = onComplete; });
  const selected = useMemo(() => beats.filter((b) => b.chapter === 'encap').map((b) => cues[b.event]).filter((c): c is Cue => Boolean(c)), [beats, cues]);
  const bytes = run.timeline.final.units.app ?? [];
  const message = new TextDecoder().decode(Uint8Array.from(bytes));
  const hex = bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const titles = beats.filter((b) => b.chapter === 'encap').map((b) => b.title);

  useMasterChild((tl) => {
    const root = scope.current;
    const label = root?.querySelector<HTMLElement>('.opening-message');
    const shells = [...(root?.querySelectorAll<HTMLElement>('.opening-shell') ?? [])];
    const first = selected[0];
    // App loads Flip together with this chunk, so it is registered before the opening mounts.
    const Flip = getFlip();
    if (!root || !label || !first || !Flip) return;
    const state = Flip.getState(label);
    label.classList.add('opening-message-core');
    tl.add(Flip.from(state, { duration: Math.min(0.6, first.endPT - first.startPT), ease: 'expo.inOut', paused: true }), first.startPT);
    const proxy = { p: 0 };
    tl.fromTo(proxy, { p: 0 }, { p: 1, duration: first.endPT - first.startPT, ease: 'none', immediateRender: false,
      onUpdate: () => { label.textContent = proxy.p < 0.15 ? message : scrambled(hex, proxy.p, 0); } }, first.startPT);
    shells.forEach((shell, i) => {
      const cue = selected[i];
      if (!cue) return;
      tl.fromTo(shell, { autoAlpha: 0, scale: 0.75 }, { autoAlpha: 1, scale: 1, duration: Math.min(0.5, cue.endPT - cue.startPT), ease: 'power4.out' }, cue.startPT);
    });
    const last = selected[selected.length - 1];
    if (last) tl.to(label, { autoAlpha: 0, duration: 0.2 }, last.startPT);
  }, [selected, message, hex], scope);

  useEffect(() => {
    if (!selected.length) { complete.current(); return; }
    let next = 0;
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    const playCue = () => {
      const cue = selected[next];
      if (!cue || cancelled) { motion.clock.pause(); complete.current(); return; }
      motion.clock.pause();
      motion.clock.seek(cue.startPT);
      unsubscribe = motion.clock.subscribe((state) => {
        if (state.pt < cue.endPT - 0.001) return;
        unsubscribe?.();
        unsubscribe = null;
        next++;
        queueMicrotask(playCue);
      });
      motion.clock.play();
    };
    playCue();
    return () => { cancelled = true; unsubscribe?.(); motion.clock.pause(); };
  }, [motion, selected]);

  return <main className="intro opening" data-testid="opening" data-message={message} ref={scope}>
    <div className="opening-scene" aria-label="Message wrapping in TCP/IP layers">
      <span className="opening-message">{message}</span>
      <span className="opening-core" aria-hidden="true" />
      {titles.map((title, i) => <div key={i} className={`opening-shell opening-shell-${i}`}><span>{title}</span></div>)}
    </div>
    <p className="opening-note mono">{hex} · SIMULATED</p>
  </main>;
}
