import { checkPayload, utf8 } from '../bytes.ts';
import type { Fault } from '../schemas.ts';
import { TEMPLATES } from './topology.ts';
import type { SimConfig } from './simulate.ts';

// Input validation for user-editable scenario fields. Some rules are demo restrictions that go
// beyond what the header fields can represent; those messages say so.

export type ConfigIssue = { field: string; message: string };

export function ipIssue(ip: string): string | null {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return 'Use dotted IPv4: four numbers 0–255, e.g. 192.168.1.10.';
  if (parts.some((p) => p.length > 1 && p.startsWith('0'))) return 'No leading zeros (some tools read them as octal).';
  const o = parts.map(Number);
  if (o.some((x) => x > 255)) return 'Each octet must be 0–255.';
  const [a = 0, , , d = 0] = o;
  if (a === 0) return '0.0.0.0/8 means "this network" and cannot be a host address.';
  if (a === 127) return 'Loopback (127.0.0.0/8) never appears on a link.';
  if (a >= 224) return 'Multicast, reserved and broadcast addresses are not supported — unicast hosts only.';
  if (d === 0 || d === 255) return 'Demo restriction: in this /24 LAN, .0 is the network and .255 the broadcast address.';
  return null;
}

export function macIssue(mac: string): string | null {
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(mac)) return 'Use six hex pairs separated by colons, e.g. 02:00:5e:a1:00:0a.';
  const bytes = mac.split(':').map((h) => parseInt(h, 16));
  if ((bytes[0] ?? 0) & 1) return 'Group (multicast/broadcast) MAC: an interface address must be unicast (I/G bit 0).';
  if (bytes.every((b) => b === 0)) return 'The all-zero MAC is not a valid interface address.';
  return null;
}

export function portIssue(p: number): string | null {
  if (!Number.isInteger(p) || p < 1 || p > 65535)
    return 'Ports 1–65535. (The 16-bit field can hold 0, but 0 means "no port" and this demo does not support it.)';
  return null;
}

const net24 = (ip: string) => ip.split('.').slice(0, 3).join('.');

export function validateSimConfig(c: SimConfig): ConfigIssue[] {
  const out: ConfigIssue[] = [];
  const add = (field: string, message: string | null) => message && out.push({ field, message });
  const http = c.payloadMode === 'http';
  if (http && c.protocol !== 'TCP')
    add('payloadMode', 'HTTP/session mode needs TCP: HTTP/1.1 runs over a reliable, ordered byte stream. UDP here supports raw echo only.');
  // An empty raw message is allowed only as the orderly no-data close (TCP with close enabled).
  const noDataClose = c.request === '' && c.protocol === 'TCP' && c.close.enabled;
  const req = checkPayload(c.request);
  if (!http && !req.ok && !noDataClose) add('request', req.error);
  if (c.close.enabled && (!Number.isInteger(c.close.timeWaitMs) || c.close.timeWaitMs < 1 || c.close.timeWaitMs > 2000))
    add('close.timeWaitMs', 'Educational TIME-WAIT: 1–2000 ms of virtual time (real 2×MSL is minutes and would dwarf the run).');
  if (!http && c.reply.enabled) {
    const rep = checkPayload(c.reply.text);
    if (!rep.ok) add('reply.text', rep.error);
  }
  for (const side of ['client', 'server'] as const) {
    const e = c.endpoints[side];
    add(`${side}.port`, portIssue(e.port));
    if (c.template === 'same-lan') {
      add(`${side}.ip`, ipIssue(e.ip));
      add(`${side}.mac`, macIssue(e.mac));
    }
  }
  add('requestDstPort', portIssue(c.requestDstPort));
  if (!Number.isInteger(c.ttl) || c.ttl < 1 || c.ttl > 255) add('ttl', 'TTL is an 8-bit field: 1–255 (0 would be discarded before sending).');
  for (const k of ['isnClient', 'isnServer'] as const) {
    const v = c.tcp[k];
    if (!Number.isInteger(v) || v < 0 || v > 0xffffffff) add(`tcp.${k}`, 'ISN must be an unsigned 32-bit integer (0–4294967295); sequence arithmetic wraps modulo 2^32.');
  }
  if (c.template === 'same-lan') {
    const { client: a, server: b } = c.endpoints;
    if (!out.some((i) => i.field.endsWith('.ip'))) {
      if (a.ip === b.ip) add('server.ip', 'Client and server need different IPv4 addresses.');
      else if (net24(a.ip) !== net24(b.ip))
        add('server.ip', `Demo restriction: the Same-LAN template is one /24 link, so the server must be in ${net24(a.ip)}.x. Use the Routed template for another network.`);
    }
    if (!out.some((i) => i.field.endsWith('.mac')) && a.mac.toLowerCase() === b.mac.toLowerCase())
      add('server.mac', 'Client and server need different MAC addresses.');
  }
  c.faults.forEach((f, i) => {
    if (f.kind === 'loss') return;
    const m = faultIssue(c, f);
    if (m) add(`faults.${i}`, m);
  });
  return out;
}

/** Packet kinds the fault lab may target: only after the connection is established (handshake/teardown NOT BUILT here). */
export const FAULT_PACKETS = { TCP: ['data', 'ack', 'response', 'response-ack'], UDP: ['data', 'response'] } as const;

function faultIssue(c: SimConfig, f: Exclude<Fault, { kind: 'loss' }>): string | null {
  const { packet, attempt, hop } = f.target;
  const allowed: readonly string[] = FAULT_PACKETS[c.protocol];
  if (!allowed.includes(packet)) {
    return c.protocol === 'UDP' && /ack/.test(packet)
      ? 'UDP has no ACKs to lose.'
      : 'Fault-lab targets start after the connection is established: SYN, FIN and their ACKs cannot be targeted (handshake/teardown faults NOT BUILT here).';
  }
  if (packet.startsWith('response') && c.payloadMode === 'raw' && !c.reply.enabled) return 'The reply is disabled in this run, so there is no reply (or its ACK) to target.';
  if ((packet === 'data' || packet === 'ack') && c.payloadMode === 'raw' && c.request === '') return 'This run sends no data (no-data close), so there is nothing to target.';
  const links = TEMPLATES[c.template].path.length - 1;
  if (!Number.isInteger(hop) || hop < 0 || hop >= links) return `Hop must be 0–${links - 1}: this path has ${links} link(s).`;
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > c.maxRetries) return `Attempt must be 0–${c.maxRetries} (0 = the original transmission).`;
  if (f.kind === 'delay' && !(Number.isFinite(f.delayMs) && f.delayMs > 0 && f.delayMs <= 2000)) return 'Delay must be more than 0 and at most 2000 ms (SIMULATED).';
  if (f.kind === 'corrupt') {
    if (!Number.isInteger(f.bit) || f.bit < 0 || f.bit > 7) return 'Bit must be 0–7.';
    const hdr = c.protocol === 'TCP' ? 20 : 8;
    const body = c.payloadMode === 'http' ? null : packet === 'data' ? utf8(c.request).length : packet === 'response' ? utf8(c.reply.text).length : 0;
    // HTTP payload sizes are generated; the engine reports an out-of-range offset as a skipped fault instead.
    if (!Number.isInteger(f.offset) || f.offset < 0 || (body !== null && f.offset >= hdr + body)) return `Offset must be within the ${body === null ? '' : `${hdr + body}-byte `}transport segment (0 = its first header byte).`;
  }
  return null;
}
