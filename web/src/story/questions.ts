import { checkPayload, portIssue, type SimConfig } from '@packetjourney/shared';

// Story questions: one at a time, each validated before Next. The answers are the shared draft config,
// so switching to Lab keeps them.

export type QuestionId = 'message' | 'transport' | 'ports' | 'scope' | 'payload' | 'fault' | 'confirm';

export const PROMPT: Record<QuestionId, string> = {
  message: 'What message should travel?',
  transport: 'Which transport carries it - TCP or UDP?',
  ports: 'Which application ports?',
  scope: 'Same network, or across routers?',
  payload: 'Raw message or HTTP?',
  fault: 'Inject a fault?',
  confirm: 'Ready? Here is your run.',
};

/** HTTP is TCP-only, so its question is skipped for UDP. */
export const questionsFor = (c: SimConfig): QuestionId[] =>
  ['message', 'transport', 'ports', 'scope', ...(c.protocol === 'TCP' ? (['payload'] as const) : []), 'fault', 'confirm'];

export type Issue = { field: string; message: string };

export function validate(q: QuestionId, c: SimConfig): Issue[] {
  const out: Issue[] = [];
  if (q === 'message') {
    const p = checkPayload(c.request);
    if (!p.ok) out.push({ field: 'request', message: p.error });
  }
  if (q === 'ports') {
    const a = portIssue(c.endpoints.client.port);
    const b = portIssue(c.endpoints.server.port);
    if (a) out.push({ field: 'client.port', message: a });
    if (b) out.push({ field: 'server.port', message: b });
    if (!a && !b && c.endpoints.client.port === c.endpoints.server.port) out.push({ field: 'server.port', message: 'Use two different ports so the two applications can be told apart.' });
  }
  return out;
}

/** Only faults the engine implements (packet loss on the sender's link). */
export type FaultChoice = 'none' | 'lose-data';
export const faultOf = (c: SimConfig): FaultChoice => (c.faults.some((f) => f.kind === 'loss' && f.packet === 'data') ? 'lose-data' : 'none');
export const withFault = (c: SimConfig, f: FaultChoice): SimConfig => ({ ...c, faults: f === 'none' ? [] : [{ kind: 'loss', packet: 'data', count: 1 }] });

export type StoryState = {
  phase: 'ask' | 'play';
  q: number;
  beat: number;
  auto: boolean;
  /** Config the story was started with (lets a reload resume the same deterministic run). */
  config: SimConfig | null;
};

export const INITIAL_STORY: StoryState = { phase: 'ask', q: 0, beat: 0, auto: false, config: null };
const KEY = 'pj.story';

export function loadStory(): StoryState {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return INITIAL_STORY;
    const s = JSON.parse(raw) as Partial<StoryState>;
    if ((s.phase === 'ask' || s.phase === 'play') && typeof s.q === 'number' && typeof s.beat === 'number') {
      return { ...INITIAL_STORY, ...s, config: s.config ?? null };
    }
  } catch {
    // Storage unavailable or corrupt: start fresh.
  }
  return INITIAL_STORY;
}

export function saveStory(s: StoryState) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Non-essential (private mode, quota): the story simply won't resume.
  }
}
