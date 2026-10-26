import { expect, it } from 'vitest';
import { buildQuestions, grade } from './questions.ts';

it('12 questions, answers derived from engine fixtures, deterministic grading', () => {
  const qs = buildQuestions();
  expect(qs).toHaveLength(12);
  expect(new Set(qs.map((q) => q.id)).size).toBe(12);
  const a = Object.fromEntries(qs.map((q) => [q.id, q.answer]));
  expect(a).toMatchObject({
    'mac-r1': '02:00:00:00:02:00', 'ttl-r2': '62', 'ip-same': 'no', 'port-b': '7007', 'ack-arith': '1006', 'syn-ack': '1001',
    'tcp-before': '3', 'udp-before': '0', 'udp-retry': '0', 'tcp-once': '1', 'fin-state': 'FIN-WAIT-1', session: 'yes',
  });
  expect(buildQuestions()).toEqual(qs); // deterministic
  const q = (id: string) => {
    const x = qs.find((y) => y.id === id);
    if (!x) throw new Error(id);
    return x;
  };
  expect(grade(q('mac-r1'), ' 02-00-00-00-02-00 ')).toBe(true);
  expect(grade(q('ttl-r2'), '62')).toBe(true);
  expect(grade(q('ttl-r2'), '62.0')).toBe(false);
  expect(grade(q('ip-same'), 'N')).toBe(true);
  expect(grade(q('fin-state'), 'fin-wait-1')).toBe(true);
  expect(grade(q('session'), '')).toBe(false);
  // Prompts carry engine values, no question needs unbuilt behaviour.
  expect(q('ack-arith').prompt).toContain('seq 1001');
  for (const x of qs) expect(x.evidence.length).toBeGreaterThan(0);
});
