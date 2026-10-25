export type Motion = 'cinematic' | 'reduced';
export type View = '3d' | '2d';

export function hasWebGL(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}
