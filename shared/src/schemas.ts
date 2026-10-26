import { z } from 'zod';

// Discriminated, serializable schemas for the engine. Behaviour for routes/interfaces/faults is NOT BUILT yet;
// the shapes exist so later phases extend rather than replace them.

export const LayerId = z.enum(['app', 'transport', 'internet', 'link', 'physical']);
export type LayerId = z.infer<typeof LayerId>;

const u8 = z.int().min(0).max(0xff);
const u16 = z.int().min(0).max(0xffff);

export const Ipv4Addr = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,3}){3}$/)
  .refine((s) => s.split('.').every((p) => Number(p) <= 255), 'octet > 255');
export const MacAddr = z.string().regex(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i);

export const Endpoint = z.object({ name: z.string(), ip: Ipv4Addr, mac: MacAddr, port: u16 });
export type Endpoint = z.infer<typeof Endpoint>;

export const Interface = z.object({ name: z.string(), ip: Ipv4Addr, prefixLength: z.int().min(0).max(32), mac: MacAddr });
export type Interface = z.infer<typeof Interface>;

export const Route = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('direct'), prefix: Ipv4Addr, prefixLength: z.int().min(0).max(32), iface: z.string() }),
  z.object({ kind: z.literal('via'), prefix: Ipv4Addr, prefixLength: z.int().min(0).max(32), gateway: Ipv4Addr, iface: z.string() }),
]);
export type Route = z.infer<typeof Route>;


export const Payload = z.object({ text: z.string() });

export const TcpFlags = z.object({ ack: z.boolean(), psh: z.boolean(), rst: z.boolean(), syn: z.boolean(), fin: z.boolean() });
export type TcpFlags = z.infer<typeof TcpFlags>;

export const TransportConfig = z.discriminatedUnion('protocol', [
  z.object({
    protocol: z.literal('TCP'),
    window: u16,
    flags: TcpFlags,
    /** Explicit numbers from the simulator; when absent the encoder uses its seeded PRNG. */
    seq: z.int().min(0).max(0xffffffff).optional(),
    ack: z.int().min(0).max(0xffffffff).optional(),
  }),
  z.object({ protocol: z.literal('UDP'), checksum: z.boolean() }),
]);
export type TransportConfig = z.infer<typeof TransportConfig>;

export const PacketKind = z.enum(['syn', 'syn-ack', 'hs-ack', 'data', 'ack', 'response', 'response-ack', 'fin-client', 'ack-fin-client', 'fin-server', 'ack-fin-server']);
export type PacketKind = z.infer<typeof PacketKind>;

// `loss` (count-based, sender's first link; phases 03–07 recovery tests, also used by Story Mode) plus the
// phase 11 targeted one-shot faults. A target names the packet kind (which also fixes the direction), the
// transmission attempt (0 = original, n = n-th retransmission) and the hop (link index along that packet's path).
export const FaultTarget = z.object({ packet: PacketKind, attempt: z.int().min(0).max(10), hop: z.int().min(0).max(8) });
export type FaultTarget = z.infer<typeof FaultTarget>;
export const Fault = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('loss'), packet: PacketKind, count: z.int().min(1).max(10) }),
  z.object({ kind: z.literal('drop'), target: FaultTarget }),
  z.object({ kind: z.literal('delay'), target: FaultTarget, delayMs: z.number().min(0.001).max(2000) }),
  /** wire: flip after FCS (fails FCS at the next receiver). transport: flip a protected transport byte and recompute the outer FCS. */
  z.object({ kind: z.literal('corrupt'), target: FaultTarget, mode: z.enum(['wire', 'transport']), offset: z.int().min(0), bit: z.int().min(0).max(7) }),
]);
export type Fault = z.infer<typeof Fault>;

export const ScenarioConfig = z.object({
  seed: z.int(),
  payload: Payload,
  transport: TransportConfig,
  src: Endpoint,
  dst: Endpoint,
  /** Link-layer next hop (gateway or destination). ARP resolution is a later phase. */
  nextHopMac: MacAddr,
  ttl: u8.min(1),
  ipId: u16.optional(),
  dscp: z.int().min(0).max(63),
  ecn: z.int().min(0).max(3),
  dontFragment: z.boolean(),
  faults: z.array(Fault),
});
export type ScenarioConfig = z.infer<typeof ScenarioConfig>;

export const FieldStatus = z.enum(['calculated', 'configured', 'illustrative']);
export type FieldStatus = z.infer<typeof FieldStatus>;

export const HeaderKind = z.enum(['payload', 'tcp', 'udp', 'ipv4', 'ethernet', 'padding', 'fcs']);
export type HeaderKind = z.infer<typeof HeaderKind>;

export const Field = z.object({
  id: z.string(),
  header: HeaderKind,
  layer: LayerId,
  name: z.string(),
  /** Absolute position inside the Ethernet frame (frame byte 0 = first destination MAC octet). */
  bitOffset: z.int().min(0),
  bitWidth: z.int().min(1),
  byteStart: z.int().min(0),
  /** Exclusive. */
  byteEnd: z.int().min(1),
  raw: z.number().nullable(),
  display: z.string(),
  status: FieldStatus,
  source: z.string(),
  explanation: z.string(),
  /** Stable assembly order (payload → transport → IPv4 → Ethernet → padding → FCS); reused by cinematic header assembly. */
  order: z.int().min(0),
});
export type Field = z.infer<typeof Field>;

