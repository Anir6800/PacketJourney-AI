import type { SimulationEvent } from '@packetjourney/shared';

// Cause chains: fault → what the engine did about it (drop / FCS or checksum reject / late arrival)
// → timeout → retransmission → duplicate suppression → outcome. Every link is an event the engine emitted.

export type ChainLink = { index: number; tag: string; device: string; label: string };

const STEPS: [RegExp, (e: SimulationEvent) => string][] = [
  [/^drop/, (e) => (e.tag === 'drop:link' ? `FCS fails at ${e.device}` : e.tag === 'drop:transport' ? `transport checksum fails at ${e.device}` : `dropped before ${e.device}`)],
  [/^timer:fire:rto$/, (e) => `${e.device} timer expires`],
  [/^tcp:retransmit$/, (e) => `${e.device} retransmits`],
  [/^tcp:duplicate$/, (e) => `${e.device} discards duplicate, re-ACKs`],
  [/^timer:giveup$/, (e) => `${e.device} gives up`],
];

/** One chain per fault event, links in event order; stops at the first delivery (or give-up) after the fault. */
export function faultChains(events: readonly SimulationEvent[]): ChainLink[][] {
  const out: ChainLink[][] = [];
  for (const f of events) {
    if (f.type !== 'fault') continue;
    const chain: ChainLink[] = [{ index: f.index, tag: f.tag, device: f.device, label: `FAULT · ${f.tag.replace('fault:', '')} (${f.explainArgs.kind}, hop ${f.explainArgs.hop})` }];
    const seen = new Set<string>();
    for (const e of events) {
      if (e.index <= f.index) continue;
      if (e.tag === 'deliver:app' || e.type === 'end') {
        chain.push({ index: e.index, tag: e.tag, device: e.device, label: e.tag === 'deliver:app' ? `${e.device} delivers once` : 'run ends' });
        break;
      }
      const step = STEPS.find(([re]) => re.test(e.tag));
      if (!step || seen.has(e.tag)) continue;
      seen.add(e.tag);
      chain.push({ index: e.index, tag: e.tag, device: e.device, label: step[1](e) });
      if (e.tag === 'timer:giveup') break;
    }
    out.push(chain);
  }
  return out;
}
