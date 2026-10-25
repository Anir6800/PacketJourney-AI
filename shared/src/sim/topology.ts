import type { Interface, Route } from '../schemas.ts';
import { HOSTS } from '../fixtures.ts';

// Fixture templates. All rates/delays are SIMULATED illustrative values, not measurements.
// Routing lookup is NOT BUILT: `path` lists the devices a client→server packet visits; replies reverse it.

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

const hostA: Device = {
  id: 'A', name: HOSTS.a.name, kind: 'host', processingNs: HOST_PROC,
  ifaces: [{ name: 'eth0', ip: HOSTS.a.ip, prefixLength: 24, mac: HOSTS.a.mac }],
  routes: [
    { kind: 'direct', prefix: '192.168.1.0', prefixLength: 24, iface: 'eth0' },
    { kind: 'via', prefix: '0.0.0.0', prefixLength: 0, gateway: HOSTS.gateway.ip, iface: 'eth0' },
  ],
};

export const TEMPLATES: Record<TemplateId, Template> = {
  'same-lan': {
    id: 'same-lan',
    client: 'A',
    server: 'B',
    path: ['A', 'B'],
    devices: {
      A: hostA,
      B: {
        id: 'B', name: HOSTS.b.name, kind: 'host', processingNs: HOST_PROC, appResponseNs: APP_RESPONSE,
        ifaces: [{ name: 'eth0', ip: HOSTS.b.ip, prefixLength: 24, mac: HOSTS.b.mac }],
        routes: [{ kind: 'direct', prefix: '192.168.1.0', prefixLength: 24, iface: 'eth0' }],
      },
    },
    links: [{ id: 'L1', a: { device: 'A', iface: 'eth0' }, b: { device: 'B', iface: 'eth0' }, bps: 100_000_000, propagationNs: 500 }],
  },
  routed: {
    id: 'routed',
    client: 'A',
    server: 'B',
    path: ['A', 'R1', 'B'],
    devices: {
      A: hostA,
      R1: {
        id: 'R1', name: 'Router R1', kind: 'router', processingNs: ROUTER_PROC,
        ifaces: [
          { name: 'eth0', ip: HOSTS.gateway.ip, prefixLength: 24, mac: HOSTS.gateway.mac },
          { name: 'eth1', ip: '10.0.0.1', prefixLength: 24, mac: '02:00:5e:b2:00:01' },
        ],
        routes: [
          { kind: 'direct', prefix: '192.168.1.0', prefixLength: 24, iface: 'eth0' },
          { kind: 'direct', prefix: '10.0.0.0', prefixLength: 24, iface: 'eth1' },
        ],
      },
      B: {
        id: 'B', name: HOSTS.remote.name, kind: 'host', processingNs: HOST_PROC, appResponseNs: APP_RESPONSE,
        ifaces: [{ name: 'eth0', ip: HOSTS.remote.ip, prefixLength: 24, mac: HOSTS.remote.mac }],
        routes: [{ kind: 'via', prefix: '0.0.0.0', prefixLength: 0, gateway: '10.0.0.1', iface: 'eth0' }],
      },
    },
    links: [
      { id: 'L1', a: { device: 'A', iface: 'eth0' }, b: { device: 'R1', iface: 'eth0' }, bps: 100_000_000, propagationNs: 500 },
      { id: 'L2', a: { device: 'R1', iface: 'eth1' }, b: { device: 'B', iface: 'eth0' }, bps: 10_000_000, propagationNs: 2_000_000 },
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

/**
 * Template with the user's endpoint addresses applied. Only Same-LAN hosts are editable;
 * Routed keeps its fixture addresses because routing lookup is NOT BUILT.
 */
export function instantiate(id: TemplateId, ep: Endpoints): Template {
  const t = structuredClone(TEMPLATES[id]);
  if (id !== 'same-lan') return t;
  for (const [dev, e] of [[t.client, ep.client], [t.server, ep.server]] as const) {
    const d = t.devices[dev];
    const i = d?.ifaces[0];
    if (!d || !i) continue;
    i.ip = e.ip;
    i.mac = e.mac;
    d.routes = [{ kind: 'direct', prefix: `${e.ip.split('.').slice(0, 3).join('.')}.0`, prefixLength: 24, iface: i.name }];
  }
  return t;
}

/** Link between two adjacent devices, oriented from → to. */
export function linkBetween(t: Template, from: DeviceId, to: DeviceId) {
  for (const l of t.links) {
    if (l.a.device === from && l.b.device === to) return { link: l, out: l.a, in: l.b };
    if (l.b.device === from && l.a.device === to) return { link: l, out: l.b, in: l.a };
  }
  throw new Error(`no link ${from}→${to}`);
}

export function iface(t: Template, end: LinkEnd): Interface {
  const i = t.devices[end.device]?.ifaces.find((x) => x.name === end.iface);
  if (!i) throw new Error(`no iface ${end.device}.${end.iface}`);
  return i;
}
