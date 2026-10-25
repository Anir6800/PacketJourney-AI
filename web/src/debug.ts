// Observable smoke-test hooks for Playwright. Holds no engine state.
export type PjDebug = {
  stageReady: boolean;
  drawCalls: number;
  contextLost: boolean;
  bootCompletions: number;
  gsapActive: () => number;
};

declare global {
  interface Window {
    __pj: PjDebug;
  }
}

window.__pj ??= { stageReady: false, drawCalls: 0, contextLost: false, bootCompletions: 0, gsapActive: () => 0 };
export const debug = window.__pj;
