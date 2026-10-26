import { gsap } from 'gsap';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { useGSAP } from '@gsap/react';
import { debug } from './debug.ts';

// Single plugin registration point. Add SplitText/DrawSVG/Flip here only when a phase uses them.
gsap.registerPlugin(useGSAP, ScrambleTextPlugin);
// Time-boxed motion (the ≤ 2.5 s intro, 160–240 ms UI micro-motion) keeps to wall time: after a main-thread stall
// it jumps ahead instead of replaying in slow motion. The master timeline is seeked by the clock and unaffected.
gsap.ticker.lagSmoothing(0);

// Running tweens/timelines only: the paused master timeline and its children never count as active.
debug.gsapActive = () => gsap.globalTimeline.getChildren(true, true, true).filter((t) => t.isActive()).length;

export { gsap, useGSAP };
