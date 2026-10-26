import { deepFreeze } from './sim/state.ts';
import { defaultSimConfig, type SimConfig } from './sim/simulate.ts';
import type { CookieChoice } from './sim/session.ts';

export const MODEL_VERSION = '14';

export type PresetId =
  | 'tcp-hello'
  | 'udp-echo'
  | 'routed-ttl-mac'
  | 'tcp-data-loss'
  | 'tcp-ack-loss'
  | 'udp-loss'
  | 'header-corruption'
  | 'application-session';

export type ScenarioPreset = {
  id: PresetId;
  name: string;
  demonstrates: string;
  simulated: string;
  config: Readonly<SimConfig>;
  cookieB: CookieChoice;
};

const make = (id: PresetId, name: string, demonstrates: string, simulated: string, config: SimConfig, cookieB: CookieChoice = 'valid'): ScenarioPreset =>
  deepFreeze({ id, name, demonstrates, simulated, config, cookieB });

const tcpHello = { ...defaultSimConfig('same-lan', 'TCP'), seed: 1401 };
const udpEcho = defaultSimConfig('same-lan', 'UDP');
const routed = { ...defaultSimConfig('routed', 'UDP'), seed: 1403, request: 'TTL and MAC', reply: { enabled: false, text: 'World' }, ttl: 5 };
const tcpLoss = {
  ...defaultSimConfig('same-lan', 'TCP'), seed: 1404,
  faults: [{ kind: 'drop', target: { packet: 'data', attempt: 0, hop: 0 } }],
} satisfies SimConfig;
const ackLoss = {
  ...defaultSimConfig('same-lan', 'TCP'), seed: 1405, reply: { enabled: false, text: 'World' },
  faults: [{ kind: 'drop', target: { packet: 'ack', attempt: 0, hop: 0 } }],
} satisfies SimConfig;
const udpLoss = {
  ...defaultSimConfig('same-lan', 'UDP'), seed: 1406, reply: { enabled: false, text: 'World' },
  faults: [{ kind: 'drop', target: { packet: 'data', attempt: 0, hop: 0 } }],
} satisfies SimConfig;
const corrupt = {
  ...defaultSimConfig('same-lan', 'UDP'), seed: 1407, reply: { enabled: false, text: 'World' },
  faults: [{ kind: 'corrupt', target: { packet: 'data', attempt: 0, hop: 0 }, mode: 'transport', offset: 0, bit: 0 }],
} satisfies SimConfig;
const session = {
  ...defaultSimConfig('same-lan', 'TCP'), seed: 1408, payloadMode: 'http' as const, close: { enabled: true, timeWaitMs: 400 },
};

export const PRESETS: readonly ScenarioPreset[] = [
  make('tcp-hello', 'TCP Hello success', 'A three-way handshake, byte-sequenced Hello/World exchange, acknowledgements and a clean result.', 'Teaching ISNs, link timing and endpoint processing are SIMULATED.' , tcpHello),
  make('udp-echo', 'UDP echo', 'A Hello datagram and World reply with no connection setup, acknowledgement or transport retry.', 'The echo application and all link timing are SIMULATED.', udpEcho),
  make('routed-ttl-mac', 'Routed TTL/MAC journey', 'Three links, two router forwards, TTL decrements, and a fresh MAC pair, IPv4 checksum and FCS per hop.', 'Routes, prepopulated ARP caches and timing are SIMULATED; ARP exchange is NOT BUILT.', routed),
  make('tcp-data-loss', 'TCP data loss', 'The first TCP data segment is dropped; the simplified RTO expires and TCP retransmits it for one application delivery.', 'The loss, timer and timing are SIMULATED; congestion control and RFC 6298 estimation are NOT BUILT.', tcpLoss),
  make('tcp-ack-loss', 'TCP ACK loss', 'The first data ACK is dropped; the sender retransmits and the receiver discards the duplicate before acknowledging again.', 'The loss and fixed educational RTO are SIMULATED; the reply is disabled to expose ACK-loss recovery.', ackLoss),
  make('udp-loss', 'UDP loss', 'The only request datagram is dropped, with no transport acknowledgement, timer or retry.', 'The loss is SIMULATED; application-level recovery is NOT BUILT.', udpLoss),
  make('header-corruption', 'Header corruption', 'One UDP source-port bit changes while the Ethernet FCS is rebuilt, so link verification passes and the transport checksum rejects it.', 'The bit flip is SIMULATED and deliberately targets the transport header.', corrupt),
  make('application-session', 'Application session across connections', 'A demo cookie issued on TCP connection A is recognized on connection B with a different client port.', 'Both TCP connections, the in-memory session table and cookie are SIMULATED; HTTP is unencrypted and TLS is NOT BUILT.', session),
];

export function presetById(id: PresetId): ScenarioPreset {
  const preset = PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`Unknown preset: ${id}`);
  return preset;
}
