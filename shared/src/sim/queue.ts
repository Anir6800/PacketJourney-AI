/**
 * Binary min-heap ordered by (timeNs, priority, insertion seq). The insertion seq makes ordering of
 * equal timestamps stable and deterministic.
 */
export type Scheduled = {
  timeNs: number;
  priority: number;
  seq: number;
  run: () => void;
  /** When present and false at pop time, the item is skipped (e.g. a cancelled timer). */
  live?: (() => boolean) | undefined;
};

const less = (a: Scheduled, b: Scheduled) =>
  a.timeNs !== b.timeNs ? a.timeNs < b.timeNs : a.priority !== b.priority ? a.priority < b.priority : a.seq < b.seq;

export class EventQueue {
  private heap: Scheduled[] = [];
  private nextSeq = 0;

  get size() {
    return this.heap.length;
  }

  push(timeNs: number, run: () => void, priority = 0, live?: () => boolean): Scheduled {
    const item: Scheduled = { timeNs, priority, seq: this.nextSeq++, run, live };
    const h = this.heap;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      const hi = h[i] as Scheduled;
      const hp = h[p] as Scheduled;
      if (!less(hi, hp)) break;
      h[i] = hp;
      h[p] = hi;
      i = p;
    }
    return item;
  }

  pop(): Scheduled | undefined {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (!top || !last || h.length === 0) return top;
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && less(h[l] as Scheduled, h[m] as Scheduled)) m = l;
      if (r < h.length && less(h[r] as Scheduled, h[m] as Scheduled)) m = r;
      if (m === i) break;
      const hm = h[m] as Scheduled;
      h[m] = h[i] as Scheduled;
      h[i] = hm;
      i = m;
    }
    return top;
  }
}
