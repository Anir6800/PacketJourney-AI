import { gsap } from 'gsap';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { useGSAP } from '@gsap/react';
import { debug } from './debug.ts';

// Single plugin registration point. Add SplitText/DrawSVG/Flip here only when a phase uses them.
gsap.registerPlugin(useGSAP, ScrambleTextPlugin);
/** Flip is used only by the opening: it loads with that lazy chunk (initial JS budget ≤ 150 kB gzip) and registers here. */
let flip: typeof import('gsap/Flip').Flip | null = null;
export const loadFlip = () => import('gsap/Flip').then(({ Flip }) => { gsap.registerPlugin(Flip); flip = Flip; return Flip; });
export const getFlip = () => flip;
// Time-boxed motion (the ≤ 2.5 s intro, 160–240 ms UI micro-motion) keeps to wall time: after a main-thread stall
// it jumps ahead instead of replaying in slow motion. The master timeline is seeked by the clock and unaffected.
gsap.ticker.lagSmoothing(0);

// Running tweens/timelines only: the paused master timeline and its children never count as active.
debug.gsapActive = () => gsap.globalTimeline.getChildren(true, true, true).filter((t) => t.isActive()).length;

export { gsap, useGSAP };
