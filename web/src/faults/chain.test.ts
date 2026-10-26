import { expect, it } from 'vitest';
import { defaultSimConfig, simulate } from '@packetjourney/shared';
import { faultChains } from './chain.ts';

it('cause chains follow the engine: drop → timeout → retry → single delivery; wire corruption → FCS reject', () => {
  const tcp = simulate({ ...defaultSimConfig('routed', 'TCP'), faults: [{ kind: 'drop', target: { packet: 'data', attempt: 0, hop: 1 } }] });
  expect(faultChains(tcp.events)[0]?.map((l) => l.label)).toEqual(['FAULT · drop (data, hop 1)', 'dropped before R2', 'A timer expires', 'A retransmits', 'B delivers once']);
  const udp = simulate({ ...defaultSimConfig('same-lan', 'UDP'), faults: [{ kind: 'corrupt', target: { packet: 'data', attempt: 0, hop: 0 }, mode: 'wire', offset: 8, bit: 0 }] });
  expect(faultChains(udp.events)[0]?.map((l) => l.label)).toEqual(['FAULT · corrupt:wire (data, hop 0)', 'FCS fails at B', 'run ends']);
  expect(faultChains(simulate(defaultSimConfig('same-lan', 'UDP')).events)).toEqual([]);
});
