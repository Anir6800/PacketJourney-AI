import { prng } from './prng.ts';
import type { ScenarioConfig } from './schemas.ts';

// Demo addresses: RFC 5737 documentation blocks (192.0.2.0/24 TEST-NET-1, 198.51.100.0/24 TEST-NET-2,
// 203.0.113.0/24 TEST-NET-3) and locally administered unicast MACs (02:…).
export const HOSTS = {
  a: { name: 'Sender', ip: '192.0.2.10', mac: '02:00:00:00:0a:10' },
  b: { name: 'Receiver', ip: '192.0.2.20', mac: '02:00:00:00:0a:20' },
  gateway: { name: 'R1', ip: '192.0.2.1', mac: '02:00:00:00:01:00' },
  remote: { name: 'Receiver', ip: '203.0.113.20', mac: '02:00:00:00:0c:20' },
} as const;

export type DemoScope = 'link' | 'routed';

export function demoScenario(o: { seed: number; text: string; protocol: 'TCP' | 'UDP'; scope: DemoScope; udpChecksum?: boolean }): ScenarioConfig {
  const r = prng(o.seed ^ 0x5eed);
  const ephemeral = 49152 + Math.floor(r() * 16384); // IANA dynamic range (RFC 6335)
  const dst = o.scope === 'routed' ? HOSTS.remote : HOSTS.b;
  return {
    seed: o.seed,
    payload: { text: o.text },
    transport:
      o.protocol === 'TCP'
        ? { protocol: 'TCP', window: 64240, flags: { ack: true, psh: true, rst: false, syn: false, fin: false } }
        : { protocol: 'UDP', checksum: o.udpChecksum ?? true },
    src: { ...HOSTS.a, port: ephemeral },
    dst: { ...dst, port: 8080 },
    nextHopMac: o.scope === 'routed' ? HOSTS.gateway.mac : HOSTS.b.mac,
    ttl: 64,
    dscp: 0,
    ecn: 0,
    dontFragment: true,
    faults: [],
  };
}
