import { gsap } from 'gsap';
import { ScrambleTextPlugin } from 'gsap/ScrambleTextPlugin';
import { useGSAP } from '@gsap/react';
import { debug } from './debug.ts';

// Single plugin registration point. Add SplitText/DrawSVG/Flip here only when a phase uses them.
gsap.registerPlugin(useGSAP, ScrambleTextPlugin);

// Running tweens/timelines only: the paused master timeline and its children never count as active.
debug.gsapActive = () => gsap.globalTimeline.getChildren(true, true, true).filter((t) => t.isActive()).length;

export { gsap, useGSAP };
