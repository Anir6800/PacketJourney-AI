import { prng } from './prng.ts';
import type { ScenarioConfig } from './schemas.ts';

// Seeded demo topology (RFC 1918 addresses, locally administered MACs).
export const HOSTS = {
  a: { name: 'Host A', ip: '192.168.1.10', mac: '02:00:5e:a1:00:0a' },
  b: { name: 'Host B', ip: '192.168.1.20', mac: '02:00:5e:a1:00:14' },
  gateway: { name: 'Gateway', ip: '192.168.1.1', mac: '02:00:5e:a1:00:01' },
  remote: { name: 'Server', ip: '10.0.0.20', mac: '02:00:5e:b2:00:14' },
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
