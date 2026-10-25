import { checkPayload } from '../bytes.ts';
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
  const req = checkPayload(c.request);
  if (!req.ok) add('request', req.error);
  if (c.reply.enabled) {
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
  return out;
}
