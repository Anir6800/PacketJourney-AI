// Observable smoke-test hooks for Playwright. Holds no engine state.
export type PjDebug = {
  stageReady: boolean;
  drawCalls: number;
  contextLost: boolean;
  bootCompletions: number;
  gsapActive: () => number;
  /** Dev/test builds only (JourneyStage3D): mounted scene entities, shell states and labels. */
  scene?: () => unknown;
  /** Dev/test builds only: renderer.info memory + last frame draw calls. */
  renderInfo?: () => { geometries: number; textures: number; calls: number };
  /** Rendered 3D frames (demand rendering: should stay flat while idle). */
  frames?: number;
  /** Dev/test builds only: unique geometries referenced by the scene graph. */
  sceneGeometries?: () => number;
  /** Dev/test builds only: page coordinates of a named 3D object. */
  screenOf?: (name: string) => { x: number; y: number } | null;
};

declare global {
  interface Window {
    __pj: PjDebug;
  }
}

window.__pj ??= { stageReady: false, drawCalls: 0, contextLost: false, bootCompletions: 0, gsapActive: () => 0 };
export const debug = window.__pj;
