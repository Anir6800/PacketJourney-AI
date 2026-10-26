export type Motion = 'cinematic' | 'reduced';
export type View = '3d' | '2d';
export type Theme = 'dark';

export const PREFS_KEY = 'pj.preferences.v1';
export const SCENARIO_KEY = 'pj.scenario.v1';
export const PRACTICE_KEY = 'pj.practice';
export const DEFAULT_PREFERENCES = { version: 1, theme: 'dark', motion: null, view: '3d' } as const;
export type Preferences = { version: 1; theme: Theme; motion: Motion | null; view: View };
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type StorageState = 'ok' | 'recovered' | 'unavailable';

const store = (given?: Store) => given ?? localStorage;
const validPreferences = (v: unknown): v is Preferences => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  const p = v as Partial<Preferences>;
  return p.version === 1 && p.theme === 'dark' && (p.motion === null || p.motion === 'cinematic' || p.motion === 'reduced') && (p.view === '3d' || p.view === '2d');
};

export function loadPreferences(given?: Store): { value: Preferences; state: StorageState } {
  let s: Store;
  let raw: string | null;
  try {
    s = store(given);
    raw = s.getItem(PREFS_KEY);
  } catch {
    return { value: { ...DEFAULT_PREFERENCES }, state: 'unavailable' };
  }
  if (raw === null) return { value: { ...DEFAULT_PREFERENCES }, state: 'ok' };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (validPreferences(parsed)) return { value: parsed, state: 'ok' };
  } catch {
    // Corrupt JSON follows the same recovery path as an invalid shape.
  }
  try {
    s.removeItem(PREFS_KEY);
  } catch {
    // Reading still worked, so keep the app usable even if removal is blocked.
  }
  return { value: { ...DEFAULT_PREFERENCES }, state: 'recovered' };
}

export function savePreferences(value: Preferences, given?: Store): boolean {
  try {
    store(given).setItem(PREFS_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function readStoredScenario(given?: Store): { text: string | null; state: StorageState } {
  try {
    return { text: store(given).getItem(SCENARIO_KEY), state: 'ok' };
  } catch {
    return { text: null, state: 'unavailable' };
  }
}

export function saveStoredScenario(text: string, given?: Store): boolean {
  try {
    store(given).setItem(SCENARIO_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function removeStoredScenario(given?: Store): boolean {
  try {
    store(given).removeItem(SCENARIO_KEY);
    return true;
  } catch {
    return false;
  }
}

export function clearLocalDemoData(given?: Store): boolean {
  try {
    const s = store(given);
    for (const key of [PREFS_KEY, SCENARIO_KEY, PRACTICE_KEY]) s.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

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
