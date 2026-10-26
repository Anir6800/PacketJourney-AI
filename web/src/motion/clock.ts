// The one playback clock. It owns presentation time (PT); virtual time is derived from cues, never from wall time.
// A single requestAnimationFrame loop adds wall delta × speed; StrictMode-safe because start() is idempotent.

export const SPEEDS = [0.25, 0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

export type ClockState = { pt: number; playing: boolean; speed: Speed; duration: number };
type Listener = (s: ClockState) => void;

export class PlaybackClock {
  private s: ClockState;
  private listeners = new Set<Listener>();
  private raf: number | null = null;
  private last: number | null = null;
  /** Number of live rAF loops (0 or 1). Exposed for orphan-loop tests. */
  loops = 0;
  /** Wall milliseconds applied while playing (after the clamp): PT gained = consumed × speed. */
  consumedMs = 0;

  constructor(
    duration: number,
    private readonly frame: (cb: (t: number) => void) => number = (cb) => requestAnimationFrame(cb),
    private readonly cancel: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {
    this.s = { pt: duration, playing: false, speed: 1, duration };
  }

  get state(): ClockState {
    return this.s;
  }

  subscribe(f: Listener): () => void {
    this.listeners.add(f);
    f(this.s);
    return () => this.listeners.delete(f);
  }

  private set(patch: Partial<ClockState>) {
    this.s = { ...this.s, ...patch };
    for (const f of this.listeners) f(this.s);
  }

  /** Pure step used by the loop and by tests: advance by a wall-clock delta in ms. */
  tick(wallMs: number) {
    if (!this.s.playing) return;
    this.consumedMs += wallMs;
    const pt = Math.min(this.s.duration, this.s.pt + (wallMs / 1000) * this.s.speed);
    const done = pt >= this.s.duration;
    this.set({ pt, playing: !done });
    if (done) this.stopLoop();
  }

  play() {
    if (this.s.playing) return;
    // Playing from the end restarts from the beginning.
    this.set({ playing: true, pt: this.s.pt >= this.s.duration ? 0 : this.s.pt });
    this.startLoop();
  }

  pause() {
    if (!this.s.playing) return;
    this.set({ playing: false });
    this.stopLoop();
  }

  toggle() {
    if (this.s.playing) this.pause();
    else this.play();
  }

  seek(pt: number) {
    this.set({ pt: Math.max(0, Math.min(this.s.duration, pt)) });
  }

  setSpeed(speed: Speed) {
    this.set({ speed });
  }

  /** New run: new span, paused, positioned at `pt`. */
  reset(duration: number, pt = 0) {
    this.stopLoop();
    this.set({ duration, pt: Math.max(0, Math.min(duration, pt)), playing: false });
  }

  private startLoop() {
    if (this.raf !== null) return; // already looping: never two loops (StrictMode, double play)
    this.last = null;
    this.loops = 1;
    const step = (t: number) => {
      if (this.last !== null) this.tick(Math.min(t - this.last, 250)); // clamp very long frames (tab switches, stalls)
      this.last = t;
      if (this.s.playing && this.raf !== null) this.raf = this.frame(step);
    };
    this.raf = this.frame(step);
  }

  private stopLoop() {
    if (this.raf !== null) this.cancel(this.raf);
    this.raf = null;
    this.last = null;
    this.loops = 0;
  }

  dispose() {
    this.stopLoop();
    this.listeners.clear();
  }
}
