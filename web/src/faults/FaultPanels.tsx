import { useMemo } from 'react';
import type { SimulationEvent } from '@packetjourney/shared';
import { faultChains } from './chain.ts';

/** Cause arrows: fault → consequence → … → outcome. Chips light up as playback reaches them; click to jump. */
export function FaultChain({ events, step, onStep }: { events: readonly SimulationEvent[]; step: number; onStep: (i: number) => void }) {
  const chains = useMemo(() => faultChains(events), [events]);
  if (!chains.length) return null;
  return (
    <section className="fault-chain" aria-label="Fault cause chain" data-testid="fault-chain">
      {chains.map((c, ci) => (
        <ol key={ci} className="chain">
          {c.map((l, i) => (
            <li key={l.index} data-reached={l.index <= step ? '' : undefined} data-current={l.index === step ? '' : undefined}>
              {i > 0 && (
                <span className="chain-arrow" aria-hidden="true">
                  →
                </span>
              )}
              <button type="button" className="chain-chip mono" onClick={() => onStep(l.index)} data-testid={`chain-${l.tag}`}>
                {l.label}
              </button>
            </li>
          ))}
        </ol>
      ))}
    </section>
  );
}
