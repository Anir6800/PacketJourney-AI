export type Motion = 'cinematic' | 'reduced';
export type View = '3d' | '2d';

let webgl2: boolean | null = null;

/**
 * Probed once per page: every probe creates a real WebGL context, and browsers drop the oldest
 * context (the live 3D stage) after ~16, so this must never run per render.
 */
export function hasWebGL(): boolean {
  if (webgl2 === null) {
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      webgl2 = Boolean(gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}
