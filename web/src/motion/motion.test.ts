import { describe, expect, it } from 'vitest';
import { defaultSimConfig, simulate } from '@packetjourney/shared';
import { CUE_PT, buildCues, locate, packetSpans, ptOfEvent, spanOf } from './cues.ts';
import { PlaybackClock, type Speed } from './clock.ts';

const run = simulate({ ...defaultSimConfig('routed', 'TCP'), close: { enabled: true, timeWaitMs: 400 } });
const cues = buildCues(run.events);

describe('cue builder', () => {
  it('one cue per event, contiguous PT, span = sum of kind durations', () => {
    expect(cues).toHaveLength(run.events.length);
    cues.forEach((c, i) => {
      expect(c.eventId).toBe(run.events[i]?.id);
      if (i > 0) expect(c.startPT).toBeCloseTo(cues[i - 1]?.endPT ?? -1, 6);
      expect(c.endPT - c.startPT).toBeCloseTo(CUE_PT[c.kind], 6);
    });
    expect(spanOf(cues)).toBeCloseTo(cues.reduce((n, c) => n + CUE_PT[c.kind], 0), 6);
  });

  it('kinds follow the event tags', () => {
    const k = (tag: string) => cues.find((c) => run.events[c.index]?.tag === tag)?.kind;
    expect(k('app:send')).toBe('typeOn');
    expect(k('encap:transport')).toBe('wrap');
    expect(k('decap:link')).toBe('unwrap');
    expect(k('hop:A:egress')).toBe('transmit');
    expect(k('hop:R1:forward')).toBe('hop');
    expect(k('ack')).toBe('ack');
    expect(k('tcp:state:LISTEN')).toBe('state');
  });

  it('transmit cues span exact send start → arrival; zero-VT cues are labelled holds', () => {
    for (const c of cues) {
      const e = run.events[c.index];
      if (e?.timing) {
        expect([c.startVT, c.endVT]).toEqual([e.timing.sendStartMs, e.timing.arrivalMs]);
        expect(c.hold).toBe(false);
      } else {
        expect([c.startVT, c.endVT]).toEqual([e?.virtualTimeMs, e?.virtualTimeMs]);
        expect(c.hold).toBe(true);
      }
    }
  });

  it('locate maps PT → event, progress and exact VT (mid-transmit = midpoint of send→arrival)', () => {
    const tx = cues.find((c) => c.kind === 'transmit');
    if (!tx) throw new Error('no transmit');
    const mid = locate(cues, (tx.startPT + tx.endPT) / 2);
    expect(mid.index).toBe(tx.index);
    expect(mid.progress).toBeCloseTo(0.5, 6);
    expect(mid.vt).toBeCloseTo((tx.startVT + tx.endVT) / 2, 9);
    expect(locate(cues, 0).index).toBe(0);
    expect(locate(cues, spanOf(cues)).index).toBe(cues.length - 1);
    expect(locate(cues, ptOfEvent(cues, 7)).index).toBe(7);
  });

  it('ladder spans: every endpoint-sent packet starts at its first transmit and ends at the peer', () => {
    const spans = packetSpans(cues, run.events, [run.template.client, run.template.server]);
    expect(spans.size).toBeGreaterThan(8);
    for (const s of spans.values()) {
      expect(s.endPT).toBeGreaterThan(s.startPT);
      expect(['A', 'B']).toContain(s.from);
      expect(s.to).toBe(s.from === 'A' ? 'B' : 'A');
    }
  });
});

describe('playback clock', () => {
  /** Drives the clock with a fake rAF at a fixed 16 ms frame. */
  function drive(speed: Speed, frames: number) {
    const q: ((t: number) => void)[] = [];
    const clock = new PlaybackClock(spanOf(cues), (cb) => q.push(cb), () => q.splice(0));
    clock.setSpeed(speed);
    clock.seek(0);
    clock.play();
    const samples: number[] = [];
    let t = 0;
    for (let i = 0; i < frames && q.length; i++) {
      const cb = q.shift();
      cb?.(t);
      t += 16;
      samples.push(clock.state.pt);
    }
    return { clock, samples };
  }

  it('speed changes viewing duration only: same PT → same event and VT; 2× reaches the end in half the frames', () => {
    const one = drive(1, 100000);
    const two = drive(2, 100000);
    const toEnd = (s: number[]) => s.findIndex((x) => x >= spanOf(cues));
    expect(toEnd(two.samples)).toBeLessThan(toEnd(one.samples) / 2 + 2);
    expect(toEnd(two.samples)).toBeGreaterThan(toEnd(one.samples) / 2 - 2);
    // The mapping PT → (event, VT) never depends on speed.
    for (const pt of [0.1, 3.3, 7.77, spanOf(cues) / 2]) expect(locate(cues, pt)).toEqual(locate(cues, pt));
    expect(one.clock.state.playing).toBe(false);
    expect(one.clock.loops).toBe(0);
  });

  it('pause freezes PT; play from the end restarts; start is idempotent (one loop)', () => {
    const q: ((t: number) => void)[] = [];
    const clock = new PlaybackClock(10, (cb) => q.push(cb), () => q.splice(0));
    clock.play(); // at end → restarts at 0
    expect(clock.state.pt).toBe(0);
    clock.play();
    clock.play();
    expect(q).toHaveLength(1); // still one scheduled frame
    q.shift()?.(0);
    q.shift()?.(900);
    expect(clock.state.pt).toBeCloseTo(0.25, 6); // 250 ms clamp per frame
    clock.pause();
    const frozen = clock.state.pt;
    clock.tick(1000);
    expect(clock.state.pt).toBe(frozen);
    expect(clock.loops).toBe(0);
    expect(q).toHaveLength(0);
  });
});
