import { useMemo, useRef } from 'react';
import type { SimRun } from '@packetjourney/shared';
import type { Cue } from './motion/cues.ts';
import { useMasterChild } from './motion/motion.ts';
import { dur, ease } from './tokens.ts';
import { gsap } from './gsap.ts';

// Presentation-only DOM choreography over the stage: header fields fly in from the inspector side, checksums
// scramble-decode to the engine's computed hex, validation ticks appear on unwrap. Every string comes from events.

const HEX = '0123456789ABCDEF';
/**
 * Deterministic scramble-decode: characters left of the reveal front are final, the rest are hex noise that is a
 * pure function of (position, line, progress step). Unlike a random scramble, any scrub position renders identically.
 */
export function scrambled(text: string, p: number, salt: number): string {
  const front = Math.floor(p * text.length);
  const step = Math.floor(p * 24);
  return Array.from(text, (ch, i) => (i < front || ch === ' ' ? ch : (HEX[(i * 7 + salt * 13 + step * 5) % 16] ?? '0'))).join('');
}

type Line = { pt: number; d: number; head: string; value: string; scramble: boolean; fly: boolean };

const HEADER: Record<string, string> = { 'encap:transport': 'Transport header', 'encap:internet': 'IPv4 header', 'encap:link': 'Ethernet header + FCS' };

function checksumOf(args: Record<string, string | number>): string | null {
  const k = Object.keys(args).find((x) => /checksum|crc|fcs/i.test(x) && /^0x|^[0-9A-F]{2}( [0-9A-F]{2})+$/i.test(String(args[x])));
  return k ? String(args[k]) : null;
}

function linesFor(run: SimRun, cues: Cue[]): Line[] {
  const out: Line[] = [];
  for (const c of cues) {
    const e = run.events[c.index];
    if (!e) continue;
    const a = e.explainArgs;
    const d = c.endPT - c.startPT;
    if (HEADER[e.tag]) {
      // Ethernet: the FCS is the frame's last 4 bytes (engine output); other headers carry their checksum field.
      const fcs = e.tag === 'encap:link' && e.bytes ? e.bytes.slice(-4).map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ') : null;
      const cs = fcs ?? checksumOf(a);
      const ttl = e.tag === 'encap:internet' ? ` · TTL ${a.ttl}` : '';
      out.push({ pt: c.startPT, d, head: `${e.device} · ${HEADER[e.tag]} · ${a.bytes} B${ttl}`, value: cs ? `${fcs ? 'FCS' : 'checksum'} ${cs}` : '', scramble: Boolean(cs), fly: true });
    } else if (/^hop:.+:forward$/.test(e.tag)) {
      out.push({ pt: c.startPT, d, head: `${e.device} · TTL ${a.ttlFrom} → ${a.ttlTo}`, value: `header checksum ${a.csFrom} → ${a.csTo}`, scramble: true, fly: false });
    } else if (e.tag === 'verify:link') {
      out.push({ pt: c.startPT, d, head: `${e.device} ✓ FCS`, value: String(a.fcs ?? ''), scramble: false, fly: false });
    } else if (e.tag === 'verify:internet') {
      out.push({ pt: c.startPT, d, head: `${e.device} ✓ IPv4 checksum`, value: String(a.checksum ?? ''), scramble: false, fly: false });
    } else if (e.tag === 'verify:transport') {
      out.push({ pt: c.startPT, d, head: `${e.device} ✓ transport checksum`, value: String(a.checksum ?? ''), scramble: false, fly: false });
    } else if (e.tag === 'socket:select') {
      out.push({ pt: c.startPT, d, head: `${e.device} ✓ port ${a.port}`, value: `→ ${a.app}`, scramble: false, fly: false });
    } else if (c.kind === 'drop') {
      out.push({ pt: c.startPT, d, head: `${e.device} ✕ ${e.tag}`, value: '', scramble: false, fly: false });
    }
  }
  return out;
}

export function CueOverlay({ run, cues, reduced }: { run: SimRun; cues: Cue[]; reduced: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => linesFor(run, cues), [run, cues]);

  useMasterChild(
    (tl) => {
      const el = root.current;
      const head = el?.querySelector<HTMLElement>('.decoder-head');
      const value = el?.querySelector<HTMLElement>('.decoder-value');
      const flyer = el?.querySelector<HTMLElement>('.flyer');
      if (!el || !head || !value || !flyer || !lines.length) return;
      // Measured transform: the flyer starts at the inspector's edge (right of the stage) and lands on the decoder.
      const insp = document.getElementById('inspector')?.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const fromX = insp && insp.width > 0 ? Math.max(40, Math.min(420, insp.left - box.left)) : 160;
      const easeOut = gsap.parseEase(ease.out);
      // One tween over the whole span renders the overlay as a pure function of timeline time, so scrubbing in
      // either direction gives identical text (GSAP string tweens would blend the old and new strings).
      const end = cues[cues.length - 1]?.endPT ?? 0;
      const proxy = { t: 0 };
      const render = () => {
        const t = proxy.t;
        let li = -1;
        for (let i = 0; i < lines.length && (lines[i]?.pt ?? Infinity) <= t; i++) li = i;
        const l = lines[li];
        el.style.visibility = l ? 'visible' : 'hidden';
        if (!l) return;
        head.textContent = l.head;
        const sd = Math.max(0.2, l.d * 0.8);
        value.textContent = l.scramble && !reduced && t < l.pt + sd ? scrambled(l.value, (t - l.pt) / sd, li) : l.value;
        const fd = Math.min(l.d, 0.45);
        const ft = t - l.pt;
        if (l.fly && !reduced && ft < fd + dur.micro) {
          const k = easeOut(Math.min(1, ft / fd));
          const out = ft > fd ? (ft - fd) / dur.micro : 0;
          flyer.textContent = l.head.split(' · ')[1] ?? '';
          flyer.style.visibility = 'visible';
          flyer.style.opacity = String(k * (1 - out));
          flyer.style.transform = `translateX(${(fromX * (1 - k)).toFixed(1)}px)`;
        } else flyer.style.visibility = 'hidden';
      };
      tl.fromTo(proxy, { t: 0 }, { t: end, duration: end, ease: 'none', immediateRender: false, onUpdate: render }, 0);
    },
    [lines, cues, reduced],
    root,
  );

  return (
    <div className="cue-overlay" ref={root} aria-hidden="true" data-testid="cue-overlay">
      <div className="flyer" />
      <div className="decoder">
        <span className="decoder-head" />
        <span className="decoder-value mono" data-testid="decoder-value" />
      </div>
    </div>
  );
}
