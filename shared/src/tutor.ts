import { z } from 'zod';

// Wire contract for POST /api/explain. The client sends a bounded snapshot of facts it already shows;
// the server answers with display-only text plus references to the supplied ids. Never commands.

export const TUTOR_LIMITS = { question: 300, fields: 24, display: 160, eventText: 400, stateEntries: 12, explanation: 2000, caveats: 4, body: '16kb' } as const;

const Text = (max: number) => z.string().max(max);

export const TutorField = z.object({
  id: Text(60),
  name: Text(80),
  display: Text(TUTOR_LIMITS.display),
  byteStart: z.int().min(0).max(4096),
  byteEnd: z.int().min(0).max(4096),
});
export type TutorField = z.infer<typeof TutorField>;

export const ExplainRequest = z.object({
  kind: z.enum(['layer', 'field', 'why', 'compare']),
  protocol: z.enum(['TCP', 'UDP']),
  question: Text(TUTOR_LIMITS.question).default(''),
  context: z.object({
    layer: z.enum(['app', 'transport', 'internet', 'link', 'physical']).nullable(),
    field: TutorField.nullable(),
    fields: z.array(TutorField).max(TUTOR_LIMITS.fields),
    event: z.object({ id: Text(20), tag: Text(60), device: Text(20), text: Text(TUTOR_LIMITS.eventText), timeMs: z.number() }).nullable(),
    /** e.g. TCP states per endpoint; small string map. */
    state: z.record(Text(30), Text(60)).refine((r) => Object.keys(r).length <= TUTOR_LIMITS.stateEntries, 'too many state entries'),
  }),
});
export type ExplainRequest = z.infer<typeof ExplainRequest>;

/** What the model must return (validated before anything reaches the client). */
export const ModelAnswer = z.object({
  explanation: z.string().min(1).max(TUTOR_LIMITS.explanation),
  refs: z.array(z.string().max(60)).max(30).default([]),
  caveats: z.array(z.string().max(300)).max(TUTOR_LIMITS.caveats).default([]),
});

export const ExplainResponse = z.object({
  explanation: z.string(),
  refs: z.array(z.string()),
  caveats: z.array(z.string()),
  source: z.enum(['live-ai', 'built-in']),
  /** verified: every ref and number checked against the supplied facts; generated: could not be verified. */
  grounding: z.enum(['verified', 'generated']),
});
export type ExplainResponse = z.infer<typeof ExplainResponse>;

/** Ids the answer may reference: supplied field ids and the event id. */
export function suppliedIds(r: ExplainRequest): Set<string> {
  const ids = new Set(r.context.fields.map((f) => f.id));
  if (r.context.field) ids.add(r.context.field.id);
  if (r.context.event) ids.add(r.context.event.id);
  return ids;
}

/** Every number written in the facts the client supplied (fields, event text, state, question). */
export function suppliedNumbers(r: ExplainRequest): Set<string> {
  const text = [
    ...r.context.fields.flatMap((f) => [f.display, f.name, String(f.byteStart), String(f.byteEnd)]),
    r.context.field ? `${r.context.field.display} ${r.context.field.byteStart} ${r.context.field.byteEnd}` : '',
    r.context.event ? `${r.context.event.text} ${r.context.event.timeMs}` : '',
    ...Object.values(r.context.state),
    r.question,
  ].join(' ');
  return new Set(numbersIn(text));
}

/** Decimal / hex numbers in text; small counting words like "1" and "2" are ignored by callers if desired. */
export const numbersIn = (s: string): string[] => (s.match(/0x[0-9a-f]+|\d+(?:\.\d+)?/gi) ?? []).map((n) => n.toLowerCase());

/**
 * Grounding check: drops refs that were not supplied and verifies every number in the explanation appears in the
 * supplied facts (digits 0–9 alone are allowed: counting words like "3 layers"). Unverifiable → `generated`.
 */
export function ground(req: ExplainRequest, ans: z.infer<typeof ModelAnswer>): Omit<ExplainResponse, 'source'> {
  const ids = suppliedIds(req);
  const refs = ans.refs.filter((r) => ids.has(r));
  const nums = suppliedNumbers(req);
  const unknown = numbersIn(ans.explanation).filter((n) => !nums.has(n) && !/^\d$/.test(n));
  const caveats = [...ans.caveats];
  if (refs.length < ans.refs.length) caveats.push('Some references did not match the supplied fields and were removed.');
  if (unknown.length) caveats.push(`Numbers not found in the supplied facts: ${[...new Set(unknown)].slice(0, 6).join(', ')}. Check the field panel.`);
  return { explanation: ans.explanation, refs, caveats, grounding: refs.length === ans.refs.length && !unknown.length ? 'verified' : 'generated' };
}
