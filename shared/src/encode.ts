import { hex, ipBytes, macBytes } from './bytes.ts';
import { crc32, fcsBytes, internetChecksum, pseudoHeader, udpWireChecksum } from './checksum.ts';
import { prng, u16, u32 } from './prng.ts';
import type { Field, FieldStatus, HeaderKind, LayerId, ScenarioConfig } from './schemas.ts';

// Network byte order (big-endian), MSB-first bit packing. One spec list per header drives both
// the bytes and the field map, so offsets can never drift from the encoding.

type Spec = {
  key: string;
  name: string;
  bits: number;
  value: number | Uint8Array;
  status: FieldStatus;
  source: string;
  explanation: string;
  display?: string;
};

export const IPPROTO_TCP = 6;
export const IPPROTO_UDP = 17;
export const ETHERTYPE_IPV4 = 0x0800;
export const ETH_MIN_PAYLOAD = 46;

function pack(specs: Spec[]): Uint8Array {
  const total = specs.reduce((n, s) => n + s.bits, 0);
  if (total % 8) throw new Error(`header not byte-aligned: ${total} bits`);
  const out = new Uint8Array(total / 8);
  let bit = 0;
  for (const s of specs) {
    if (s.value instanceof Uint8Array) {
      if (bit % 8 || s.value.length * 8 !== s.bits) throw new Error(`bad byte field ${s.key}`);
      out.set(s.value, bit / 8);
    } else {
      if (s.value < 0 || s.value >= 2 ** s.bits) throw new Error(`${s.key}=${s.value} does not fit ${s.bits} bits`);
      for (let i = 0; i < s.bits; i++) {
        const v = Math.floor(s.value / 2 ** (s.bits - 1 - i)) % 2;
        const at = bit + i;
        if (v) out[at >> 3] = (out[at >> 3] ?? 0) | (0x80 >> (at & 7));
      }
    }
    bit += s.bits;
  }
  return out;
}

const fmt = (s: Spec): string => {
  if (s.display) return s.display;
  if (s.value instanceof Uint8Array) return Array.from(s.value, (b) => hex(b)).join(' ');
  if (s.bits === 1) return String(s.value);
  return `${s.value} (0x${hex(s.value, Math.ceil(s.bits / 4))})`;
};

function place(specs: Spec[], header: HeaderKind, layer: LayerId, frameByte: number): Omit<Field, 'order'>[] {
  let bit = frameByte * 8;
  return specs.map((s) => {
    const f = {
      id: `${header}.${s.key}`,
      header,
      layer,
      name: s.name,
      bitOffset: bit,
      bitWidth: s.bits,
      byteStart: bit >> 3,
      byteEnd: (bit + s.bits + 7) >> 3,
      raw: s.value instanceof Uint8Array ? null : s.value,
      display: fmt(s),
      status: s.status,
      source: s.source,
      explanation: s.explanation,
    };
    bit += s.bits;
    return f;
  });
}

const NOT_MODELLED = 'Not modelled in this simulator: displayed only and normally 0.';

function tcpSpecs(c: ScenarioConfig & { transport: { protocol: 'TCP' } }, seq: number, ack: number, checksum: number): Spec[] {
  const f = c.transport.flags;
  const flag = (key: string, name: string, v: boolean, explanation: string, modelled = true): Spec => ({
    key, name, bits: 1, value: v ? 1 : 0,
    status: modelled ? 'configured' : 'illustrative',
    source: modelled ? 'scenario flags' : 'constant 0',
    explanation: modelled ? explanation : `${explanation} ${NOT_MODELLED}`,
  });
  return [
    { key: 'srcPort', name: 'Source port', bits: 16, value: c.src.port, status: 'configured', source: 'seeded ephemeral port', explanation: 'Sender application port (RFC 9293 §3.1).' },
    { key: 'dstPort', name: 'Destination port', bits: 16, value: c.dst.port, status: 'configured', source: 'scenario', explanation: 'Receiver application port.' },
    { key: 'seqNumber', name: 'Sequence number', bits: 32, value: seq, status: 'configured', source: 'seeded PRNG (simplification of RFC 9293 §3.4.1 ISN)', explanation: 'Number of the first data byte in this segment.' },
    { key: 'ackNumber', name: 'Acknowledgment number', bits: 32, value: ack, status: 'configured', source: 'seeded PRNG (no handshake modelled yet)', explanation: 'Next byte the sender expects from the peer; valid because ACK=1.' },
    { key: 'dataOffset', name: 'Data offset', bits: 4, value: 5, status: 'calculated', source: '20-byte header / 4', explanation: 'Header length in 32-bit words; 5 = 20 bytes, no options.' },
    { key: 'reserved', name: 'Reserved', bits: 4, value: 0, status: 'illustrative', source: 'constant 0', explanation: 'Reserved; must be zero (RFC 9293).' },
    flag('cwr', 'CWR', false, 'Congestion Window Reduced (RFC 3168).', false),
    flag('ece', 'ECE', false, 'ECN-Echo (RFC 3168).', false),
    flag('urg', 'URG', false, 'Urgent pointer significant.', false),
    flag('ack', 'ACK', f.ack, 'Acknowledgment field is significant.'),
    flag('psh', 'PSH', f.psh, 'Push: deliver to the application promptly.'),
    flag('rst', 'RST', f.rst, 'Reset the connection.'),
    flag('syn', 'SYN', f.syn, 'Synchronize sequence numbers (handshake).'),
    flag('fin', 'FIN', f.fin, 'No more data from sender.'),
    { key: 'window', name: 'Window', bits: 16, value: c.transport.window, status: 'configured', source: 'scenario (fixed)', explanation: 'Receive window in bytes; fixed in this simulator (no scaling).' },
    { key: 'checksum', name: 'Checksum', bits: 16, value: checksum, status: 'calculated', source: 'RFC 1071 over pseudo-header + TCP header + data', explanation: 'Covers IPv4 pseudo-header (src, dst, 0, 6, TCP length), header and payload.' },
    { key: 'urgent', name: 'Urgent pointer', bits: 16, value: 0, status: 'illustrative', source: 'constant 0', explanation: `Only meaningful with URG=1. ${NOT_MODELLED}` },
  ];
}

function udpSpecs(c: ScenarioConfig, length: number, checksum: number, enabled: boolean): Spec[] {
  return [
    { key: 'srcPort', name: 'Source port', bits: 16, value: c.src.port, status: 'configured', source: 'seeded ephemeral port', explanation: 'Sender application port (RFC 768).' },
    { key: 'dstPort', name: 'Destination port', bits: 16, value: c.dst.port, status: 'configured', source: 'scenario', explanation: 'Receiver application port.' },
    { key: 'length', name: 'Length', bits: 16, value: length, status: 'calculated', source: '8 + payload bytes', explanation: 'UDP header plus data, in bytes.' },
    enabled
      ? { key: 'checksum', name: 'Checksum', bits: 16, value: checksum, status: 'calculated', source: 'RFC 1071 over pseudo-header + UDP header + data', explanation: 'A computed 0 is sent as 0xFFFF (RFC 768).' }
      : { key: 'checksum', name: 'Checksum', bits: 16, value: 0, status: 'configured', source: 'checksum disabled', explanation: '0 means "no checksum supplied" (allowed for UDP over IPv4).' },
  ];
}

function ipv4Specs(c: ScenarioConfig, totalLength: number, id: number, protocol: number, checksum: number): Spec[] {
  return [
    { key: 'version', name: 'Version', bits: 4, value: 4, status: 'calculated', source: 'constant', explanation: 'IP version 4 (RFC 791).' },
    { key: 'ihl', name: 'IHL', bits: 4, value: 5, status: 'calculated', source: '20-byte header / 4', explanation: 'Header length in 32-bit words; 5 = no options.' },
    { key: 'dscp', name: 'DSCP', bits: 6, value: c.dscp, status: 'configured', source: 'scenario', explanation: 'Differentiated services code point (RFC 2474).' },
    { key: 'ecn', name: 'ECN', bits: 2, value: c.ecn, status: 'configured', source: 'scenario', explanation: 'Explicit congestion notification (RFC 3168).' },
    { key: 'totalLength', name: 'Total length', bits: 16, value: totalLength, status: 'calculated', source: 'IPv4 header + transport', explanation: 'Whole IP packet in bytes; excludes Ethernet header, padding and FCS.' },
    { key: 'id', name: 'Identification', bits: 16, value: id, status: 'configured', source: 'seeded PRNG', explanation: 'Identifies fragments of one datagram.' },
    { key: 'flagReserved', name: 'Flag: reserved', bits: 1, value: 0, status: 'illustrative', source: 'constant 0', explanation: 'Must be zero.' },
    { key: 'df', name: "Flag: DF (don't fragment)", bits: 1, value: c.dontFragment ? 1 : 0, status: 'configured', source: 'scenario', explanation: 'Routers must not fragment this packet.' },
    { key: 'mf', name: 'Flag: MF (more fragments)', bits: 1, value: 0, status: 'calculated', source: 'single unfragmented packet', explanation: 'Fragmentation is not modelled.' },
    { key: 'fragOffset', name: 'Fragment offset', bits: 13, value: 0, status: 'calculated', source: 'single unfragmented packet', explanation: 'Offset in 8-byte units; 0 for an unfragmented packet.' },
    { key: 'ttl', name: 'TTL', bits: 8, value: c.ttl, status: 'configured', source: 'scenario', explanation: 'Decremented by each router; dropped at 0.' },
    { key: 'protocol', name: 'Protocol', bits: 8, value: protocol, status: 'calculated', source: 'transport choice', explanation: '6 = TCP, 17 = UDP.' },
    { key: 'checksum', name: 'Header checksum', bits: 16, value: checksum, status: 'calculated', source: 'RFC 1071 over the 20-byte IPv4 header', explanation: 'Covers the header only; recomputed by each router.' },
    { key: 'src', name: 'Source address', bits: 32, value: ipBytes(c.src.ip), display: c.src.ip, status: 'configured', source: 'scenario (RFC 1918)', explanation: 'Sender IPv4 address.' },
    { key: 'dst', name: 'Destination address', bits: 32, value: ipBytes(c.dst.ip), display: c.dst.ip, status: 'configured', source: 'scenario (RFC 1918)', explanation: 'Final receiver IPv4 address; unchanged across hops (no NAT).' },
  ];
}

function ethSpecs(c: ScenarioConfig): Spec[] {
  return [
    { key: 'dst', name: 'Destination MAC', bits: 48, value: macBytes(c.nextHopMac), display: c.nextHopMac, status: 'configured', source: 'next hop (ARP NOT BUILT)', explanation: 'Next hop on this link: the gateway when routed, otherwise the receiver.' },
    { key: 'src', name: 'Source MAC', bits: 48, value: macBytes(c.src.mac), display: c.src.mac, status: 'configured', source: 'sender interface', explanation: 'Sending interface (locally administered address).' },
    { key: 'etherType', name: 'EtherType', bits: 16, value: ETHERTYPE_IPV4, status: 'calculated', source: 'IPv4 payload', explanation: '0x0800 = IPv4.' },
  ];
}

export type Encoding = {
  payload: Uint8Array;
  segment: Uint8Array;
  packet: Uint8Array;
  /** Destination MAC through FCS. Preamble, SFD and interframe gap are NOT part of these bytes. */
  frame: Uint8Array;
  padding: number;
  fcs: number;
  fields: Field[];
};

/** Pure, deterministic encoder. `payload` is the already-validated UTF-8 bytes. */
export function encode(c: ScenarioConfig, payload: Uint8Array): Encoding {
  const r = prng(c.seed);
  // Always draw, then override, so the PRNG sequence doesn't depend on which values were supplied.
  const drawnSeq = u32(r);
  const drawnAck = u32(r);
  const drawnId = u16(r);
  const seq = (c.transport.protocol === 'TCP' ? c.transport.seq : undefined) ?? drawnSeq;
  const ack = (c.transport.protocol === 'TCP' ? c.transport.ack : undefined) ?? drawnAck;
  const id = c.ipId ?? drawnId;
  const src = ipBytes(c.src.ip);
  const dst = ipBytes(c.dst.ip);

  let l4Specs: Spec[];
  let protocol: number;
  const t = c.transport;
  if (t.protocol === 'TCP') {
    protocol = IPPROTO_TCP;
    const len = 20 + payload.length;
    const cs = internetChecksum(pseudoHeader(src, dst, protocol, len), pack(tcpSpecs({ ...c, transport: t }, seq, ack, 0)), payload);
    l4Specs = tcpSpecs({ ...c, transport: t }, seq, ack, cs);
  } else {
    protocol = IPPROTO_UDP;
    const len = 8 + payload.length;
    const cs = udpWireChecksum(internetChecksum(pseudoHeader(src, dst, protocol, len), pack(udpSpecs(c, len, 0, true)), payload));
    l4Specs = udpSpecs(c, len, cs, t.checksum);
  }
  const l4 = pack(l4Specs);
  const segment = concat(l4, payload);

  const totalLength = 20 + segment.length;
  const ipCs = internetChecksum(pack(ipv4Specs(c, totalLength, id, protocol, 0)));
  const ipSp = ipv4Specs(c, totalLength, id, protocol, ipCs);
  const packet = concat(pack(ipSp), segment);

  const ethSp = ethSpecs(c);
  const { frame, padding, fcs } = ethernetFrame(packet, c.nextHopMac, c.src.mac);

  const l4Kind: HeaderKind = t.protocol === 'TCP' ? 'tcp' : 'udp';
  const payloadAt = 14 + 20 + l4.length;
  const padAt = 14 + packet.length;
  const extras: Omit<Field, 'order'>[] = [
    {
      id: 'payload.data', header: 'payload', layer: 'app', name: 'Application data', bitOffset: payloadAt * 8, bitWidth: payload.length * 8,
      byteStart: payloadAt, byteEnd: payloadAt + payload.length, raw: null, display: `${payload.length} bytes UTF-8`,
      status: 'configured', source: 'TextEncoder (UTF-8)', explanation: 'The message bytes; length is UTF-8 bytes, not characters.',
    },
  ];
  const padField: Omit<Field, 'order'>[] = padding
    ? [{
        id: 'padding.bytes', header: 'padding', layer: 'link', name: 'Padding', bitOffset: padAt * 8, bitWidth: padding * 8,
        byteStart: padAt, byteEnd: padAt + padding, raw: padding, display: `${padding} × 00`, status: 'calculated',
        source: `46 − ${packet.length} packet bytes`, explanation: 'Zero bytes so the Ethernet payload reaches 46 bytes; not counted in IPv4 total length.',
      }]
    : [];
  const fcsAt = frame.length - 4;
  const fcsField: Omit<Field, 'order'> = {
    id: 'fcs.crc32', header: 'fcs', layer: 'link', name: 'FCS (CRC-32)', bitOffset: fcsAt * 8, bitWidth: 32, byteStart: fcsAt, byteEnd: frame.length,
    raw: fcs, display: `0x${hex(fcs, 8)} → wire ${Array.from(fcsBytes(fcs), (b) => hex(b)).join(' ')}`, status: 'calculated',
    source: 'CRC-32 (IEEE 802.3) over destination MAC … padding',
    explanation: 'Detects corruption on the link. Shown least-significant octet first, the order it is sent and captured.',
  };

  // Assembly order (stable): payload → transport → IPv4 → Ethernet header → padding → FCS.
  const ordered = [
    ...extras,
    ...place(l4Specs, l4Kind, 'transport', 34),
    ...place(ipSp, 'ipv4', 'internet', 14),
    ...place(ethSp, 'ethernet', 'link', 0),
    ...padField,
    fcsField,
  ];
  const fields = ordered.map((f, order) => ({ ...f, order }));

  return { payload, segment, packet, frame, padding, fcs, fields };
}

/** Ethernet II frame around an IPv4 packet: header, zero padding to 46, LE CRC-32 FCS. */
export function ethernetFrame(packet: Uint8Array, dstMac: string, srcMac: string) {
  const padding = Math.max(0, ETH_MIN_PAYLOAD - packet.length);
  const body = concat(macBytes(dstMac), macBytes(srcMac), Uint8Array.from([ETHERTYPE_IPV4 >> 8, ETHERTYPE_IPV4 & 0xff]), packet, new Uint8Array(padding));
  const fcs = crc32(body);
  return { frame: concat(body, fcsBytes(fcs)), padding, fcs };
}

/** Strip Ethernet header/padding/FCS using the IPv4 total length. */
export function packetFromFrame(frame: Uint8Array): Uint8Array {
  const total = ((frame[16] ?? 0) << 8) | (frame[17] ?? 0);
  return frame.slice(14, 14 + total);
}

/**
 * Router forwarding of an IPv4 packet (RFC 791 / RFC 1812 §5.3.1): TTL − 1 and the header checksum
 * recomputed. Returns null when TTL would reach 0 (drop). Addresses are unchanged (no NAT).
 */
export function forwardPacket(packet: Uint8Array): Uint8Array | null {
  const ttl = packet[8] ?? 0;
  if (ttl <= 1) return null;
  const out = packet.slice();
  out[8] = ttl - 1;
  out[10] = out[11] = 0;
  const ihl = ((out[0] ?? 0x45) & 0x0f) * 4;
  const cs = internetChecksum(out.slice(0, ihl));
  out[10] = cs >> 8;
  out[11] = cs & 0xff;
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
