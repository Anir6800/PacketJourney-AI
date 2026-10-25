import type { Interface, Route } from '../schemas.ts';
import { HOSTS } from '../fixtures.ts';

// Fixed fixture templates (no topology editor). All rates/delays are SIMULATED illustrative values.
// Every point-to-point Ethernet link is its own subnet; forwarding uses each device's route table
// (longest-prefix match) and a prepopulated ARP cache. `path` is only the left-to-right drawing order.

export type DeviceId = string;
export type Device = {
  id: DeviceId;
  name: string;
  kind: 'host' | 'router';
  ifaces: Interface[];
  routes: Route[];
  /** Per-packet processing before transmit/forward/deliver, ns. */
  processingNs: number;
  /** Server application think time before replying, ns. */
  appResponseNs?: number;
};
export type LinkEnd = { device: DeviceId; iface: string };
export type Link = { id: string; a: LinkEnd; b: LinkEnd; bps: number; propagationNs: number };
export type TemplateId = 'same-lan' | 'routed';
export type Template = { id: TemplateId; devices: Record<DeviceId, Device>; links: Link[]; path: DeviceId[]; client: DeviceId; server: DeviceId };

const HOST_PROC = 20_000; // 20 µs
const ROUTER_PROC = 50_000; // 50 µs
const APP_RESPONSE = 1_000_000; // 1 ms
const MBPS = 1_000_000;

const host = (id: string, name: string, ip: string, mac: string, routes: Route[], appResponseNs?: number): Device => ({
  id, name, kind: 'host', processingNs: HOST_PROC, ...(appResponseNs ? { appResponseNs } : {}),
  ifaces: [{ name: 'eth0', ip, prefixLength: 24, mac }],
  routes,
});

export const TEMPLATES: Record<TemplateId, Template> = {
  'same-lan': {
    id: 'same-lan',
    client: 'A',
    server: 'B',
    path: ['A', 'B'],
    devices: {
      A: host('A', HOSTS.a.name, HOSTS.a.ip, HOSTS.a.mac, [{ kind: 'direct', prefix: '192.0.2.0', prefixLength: 24, iface: 'eth0' }]),
      B: host('B', HOSTS.b.name, HOSTS.b.ip, HOSTS.b.mac, [{ kind: 'direct', prefix: '192.0.2.0', prefixLength: 24, iface: 'eth0' }], APP_RESPONSE),
    },
    links: [{ id: 'L1', a: { device: 'A', iface: 'eth0' }, b: { device: 'B', iface: 'eth0' }, bps: 100 * MBPS, propagationNs: 500 }],
  },
  routed: {
    id: 'routed',
    client: 'A',
    server: 'B',
    path: ['A', 'R1', 'R2', 'B'],
    devices: {
      A: host('A', HOSTS.a.name, HOSTS.a.ip, HOSTS.a.mac, [
        { kind: 'direct', prefix: '192.0.2.0', prefixLength: 24, iface: 'eth0' },
        { kind: 'via', prefix: '0.0.0.0', prefixLength: 0, gateway: '192.0.2.1', iface: 'eth0' },
      ]),
      R1: {
        id: 'R1', name: 'R1', kind: 'router', processingNs: ROUTER_PROC,
        ifaces: [
          { name: 'eth0', ip: '192.0.2.1', prefixLength: 24, mac: '02:00:00:00:01:00' },
          { name: 'eth1', ip: '198.51.100.1', prefixLength: 30, mac: '02:00:00:00:01:01' },
        ],
        routes: [
          { kind: 'direct', prefix: '192.0.2.0', prefixLength: 24, iface: 'eth0' },
          { kind: 'direct', prefix: '198.51.100.0', prefixLength: 30, iface: 'eth1' },
          { kind: 'via', prefix: '203.0.113.0', prefixLength: 24, gateway: '198.51.100.2', iface: 'eth1' },
        ],
      },
      R2: {
        id: 'R2', name: 'R2', kind: 'router', processingNs: ROUTER_PROC,
        ifaces: [
          { name: 'eth0', ip: '198.51.100.2', prefixLength: 30, mac: '02:00:00:00:02:00' },
          { name: 'eth1', ip: '203.0.113.1', prefixLength: 24, mac: '02:00:00:00:02:01' },
        ],
        routes: [
          { kind: 'direct', prefix: '198.51.100.0', prefixLength: 30, iface: 'eth0' },
          { kind: 'direct', prefix: '203.0.113.0', prefixLength: 24, iface: 'eth1' },
          { kind: 'via', prefix: '192.0.2.0', prefixLength: 24, gateway: '198.51.100.1', iface: 'eth0' },
        ],
      },
      B: host('B', HOSTS.remote.name, HOSTS.remote.ip, HOSTS.remote.mac, [
        { kind: 'direct', prefix: '203.0.113.0', prefixLength: 24, iface: 'eth0' },
        { kind: 'via', prefix: '0.0.0.0', prefixLength: 0, gateway: '203.0.113.1', iface: 'eth0' },
      ], APP_RESPONSE),
    },
    links: [
      { id: 'L1', a: { device: 'A', iface: 'eth0' }, b: { device: 'R1', iface: 'eth0' }, bps: 100 * MBPS, propagationNs: 500 },
      { id: 'L2', a: { device: 'R1', iface: 'eth1' }, b: { device: 'R2', iface: 'eth0' }, bps: 10 * MBPS, propagationNs: 2_000_000 },
      { id: 'L3', a: { device: 'R2', iface: 'eth1' }, b: { device: 'B', iface: 'eth0' }, bps: 100 * MBPS, propagationNs: 500 },
    ],
  },
};

export type EndpointAddr = { ip: string; mac: string; port: number };
export type Endpoints = { client: EndpointAddr; server: EndpointAddr };

/** Template default addresses; ports are user settings and passed through. */
export function templateEndpoints(id: TemplateId, ports = { client: 50000, server: 7007 }): Endpoints {
  const t = TEMPLATES[id];
  const a = t.devices[t.client]?.ifaces[0];
  const b = t.devices[t.server]?.ifaces[0];
  return {
    client: { ip: a?.ip ?? '', mac: a?.mac ?? '', port: ports.client },
    server: { ip: b?.ip ?? '', mac: b?.mac ?? '', port: ports.server },
  };
}

const net24 = (ip: string) => `${ip.split('.').slice(0, 3).join('.')}.0`;

/** Template with the user's endpoint addresses applied. Only Same-LAN hosts are editable; Routed is fixed. */
export function instantiate(id: TemplateId, ep: Endpoints): Template {
  const t = structuredClone(TEMPLATES[id]);
  if (id !== 'same-lan') return t;
  for (const [dev, e] of [[t.client, ep.client], [t.server, ep.server]] as const) {
    const d = t.devices[dev];
    const i = d?.ifaces[0];
    if (!d || !i) continue;
    i.ip = e.ip;
    i.mac = e.mac;
    d.routes = [{ kind: 'direct', prefix: net24(e.ip), prefixLength: 24, iface: i.name }];
  }
  return t;
}

export function iface(t: Template, end: LinkEnd): Interface {
  const i = t.devices[end.device]?.ifaces.find((x) => x.name === end.iface);
  if (!i) throw new Error(`no iface ${end.device}.${end.iface}`);
  return i;
}

/** The link attached to `dev.ifaceName`, oriented outwards. */
export function linkAt(t: Template, dev: DeviceId, ifaceName: string) {
  for (const l of t.links) {
    if (l.a.device === dev && l.a.iface === ifaceName) return { link: l, out: l.a, in: l.b };
    if (l.b.device === dev && l.b.iface === ifaceName) return { link: l, out: l.b, in: l.a };
  }
  throw new Error(`no link on ${dev}.${ifaceName}`);
}

export const ipToInt = (ip: string) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
export const inPrefix = (ip: string, prefix: string, len: number) => {
  if (len === 0) return true;
  const size = 2 ** (32 - len);
  return Math.floor(ipToInt(ip) / size) === Math.floor(ipToInt(prefix) / size);
};

export type RouteChoice = { route: Route; iface: string; nextHop: string; text: string };

/** Longest-prefix match on the device's route table. Direct routes deliver to the destination itself. */
export function lookup(t: Template, dev: DeviceId, dstIp: string): RouteChoice | null {
  const routes = t.devices[dev]?.routes ?? [];
  const best = routes.filter((r) => inPrefix(dstIp, r.prefix, r.prefixLength)).sort((a, b) => b.prefixLength - a.prefixLength)[0];
  if (!best) return null;
  const nextHop = best.kind === 'via' ? best.gateway : dstIp;
  return { route: best, iface: best.iface, nextHop, text: routeText(best) };
}

export const routeText = (r: Route) => `${r.prefix}/${r.prefixLength} ${r.kind === 'via' ? `via ${r.gateway}` : 'directly connected'} dev ${r.iface}`;

/**
 * Prepopulated ARP caches: every interface knows the IP→MAC of the interface at the other end of its link.
 * ARP request/reply exchange is NOT BUILT.
 */
export function arpCaches(t: Template): Record<DeviceId, Record<string, string>> {
  const out: Record<DeviceId, Record<string, string>> = {};
  for (const l of t.links) {
    for (const [me, peer] of [[l.a, l.b], [l.b, l.a]] as const) {
      const p = iface(t, peer);
      (out[me.device] ??= {})[p.ip] = p.mac;
    }
  }
  return out;
}
