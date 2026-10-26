import { packetFromFrame, type SimRun, type SimulationEvent } from '@packetjourney/shared';
import { color } from '../tokens.ts';

// Pure scene model: everything the 3D stage draws, derived from the run + current step.
// The stage renders this and nothing else; the test hook reports it alongside the mounted scene graph.

export type ShellLayer = 'app' | 'transport' | 'internet' | 'link';

/** How many layers wrap the packet at this moment (1 = app data only … 4 = full frame). */
const DEPTH: [RegExp, number][] = [
  [/^app:(send|respond)$/, 1],
  [/^encap:transport$/, 2],
  [/^encap:internet$/, 3],
  [/^hop:.+:forward$/, 3],
  [/^(decap:link|verify:internet|drop:internet|drop:ttl|route:lookup)$/, 3],
  [/^(decap:internet|verify:transport|socket:|drop:transport)/, 2],
  [/^(decap:transport|deliver:app|app:processed|tcp:duplicate|ack)/, 1],
  [/^(encap:link|hop:|verify:link|drop|tcp:retransmit)/, 4],
];
export const depthOf = (tag: string) => DEPTH.find(([re]) => re.test(tag))?.[1] ?? 0;

/** Outermost first, matching the nesting order on the wire. */
export const SHELL_ORDER: readonly ShellLayer[] = ['link', 'internet', 'transport', 'app'];

export type Vec3 = [number, number, number];
export type SceneDevice = { id: string; kind: 'host' | 'router'; name: string; position: Vec3; label: string; labelPos: Vec3; ports: { iface: string; position: Vec3 }[] };
export type SceneIface = { device: string; iface: string; ip: string; mac: string; position: Vec3; label: string };
export type SceneLink = { id: string; from: string; to: string; points: Vec3[]; subnet: string; label: string; labelPos: Vec3; active: boolean };
export type SceneShell = { layer: ShellLayer; color: string; label: string };
export type ScenePacket = { id: string; position: Vec3; shells: SceneShell[]; onLink: string | null; bitStream: boolean };
export type SceneModel = {
  template: string;
  /** row: left→right (wide stages); column: top→bottom (narrow stages, so labels have room). */
  layout: 'row' | 'column';
  step: number;
  devices: SceneDevice[];
  ifaces: SceneIface[];
  links: SceneLink[];
  packet: ScenePacket | null;
  summary: string;
};

const SPACING = 3.2;
const ipToInt = (ip: string) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0) >>> 0;
const intToIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
export const subnetOf = (ip: string, len: number) => `${intToIp(len === 0 ? 0 : (ipToInt(ip) & (~0 << (32 - len))) >>> 0)}/${len}`;

const mac = (b: readonly number[], at: number) => b.slice(at, at + 6).map((x) => x.toString(16).padStart(2, '0')).join(':');
const ip = (b: Uint8Array, at: number) => Array.from(b.slice(at, at + 4)).join('.');
const u16 = (b: Uint8Array, at: number) => ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
const u32 = (b: Uint8Array, at: number) => (((b[at] ?? 0) << 24) >>> 0) + ((b[at + 1] ?? 0) << 16) + ((b[at + 2] ?? 0) << 8) + (b[at + 3] ?? 0);

/** Shell labels read only from the current frame bytes and the event's own arguments. */
function shellsFor(ev: SimulationEvent, frameArr: readonly number[], appBytes: number | null): SceneShell[] {
  const depth = depthOf(ev.tag);
  const frame = Uint8Array.from(frameArr);
  const pkt = packetFromFrame(frame);
  const ihl = ((pkt[0] ?? 0x45) & 0x0f) * 4;
  const seg = pkt.slice(ihl);
  const tcp = pkt[9] === 6;
  const l4 = tcp ? ((seg[12] ?? 0x50) >> 4) * 4 : 8;
  const payload = appBytes ?? seg.length - l4;
  const ttl = pkt[8] ?? 0;
  const forward = /^hop:.+:forward$/.test(ev.tag);
  const labels: Record<ShellLayer, string> = {
    app: `Application · ${payload} B`,
    transport: tcp ? `TCP · ${u16(seg, 0)} → ${u16(seg, 2)} · seq ${u32(seg, 4)}` : `UDP · ${u16(seg, 0)} → ${u16(seg, 2)}`,
    internet: `IPv4 · ${ip(pkt, 12)} → ${ip(pkt, 16)} · ${forward ? `TTL ${ev.explainArgs.ttlFrom} → ${ev.explainArgs.ttlTo}` : `TTL ${ttl}`}`,
    link: `Ethernet · ${mac(frameArr, 6)} → ${mac(frameArr, 0)}`,
  };
  return SHELL_ORDER.slice(4 - depth).map((layer) => ({ layer, color: color[layer], label: labels[layer] }));
}

export function sceneModel(run: SimRun, index: number, summary: string): SceneModel {
  const t = run.template;
  const n = t.path.length;
  const pos = (id: string): Vec3 => [(t.path.indexOf(id) - (n - 1) / 2) * SPACING, 0, 0];
  const ev = run.events[index];
  const s = run.timeline.at(index);
  const hop = ev && s.activeHop && s.activeHop.packetId === ev.packetId ? s.activeHop : null;

  const devices: SceneDevice[] = t.path.map((id) => {
    const d = t.devices[id];
    const p = pos(id);
    const ports = (d?.ifaces ?? []).map((i, k, all) => {
      // Ports sit on the side facing the neighbour the interface connects to.
      const link = t.links.find((l) => (l.a.device === id && l.a.iface === i.name) || (l.b.device === id && l.b.iface === i.name));
      const other = link ? (link.a.device === id ? link.b.device : link.a.device) : null;
      const dir = other ? Math.sign(pos(other)[0] - p[0]) : k === 0 && all.length > 1 ? -1 : 1;
      return { iface: i.name, position: [p[0] + dir * 0.62, p[1] + 0.35, p[2]] as Vec3 };
    });
    return { id, kind: d?.kind ?? 'host', name: d?.name ?? id, position: p, label: `${id} · ${d?.kind ?? 'host'}`, labelPos: [p[0], -0.12, 0], ports };
  });

  const links: SceneLink[] = t.links.map((l) => {
    const a = pos(l.a.device);
    const b = pos(l.b.device);
    const ai = t.devices[l.a.device]?.ifaces.find((i) => i.name === l.a.iface);
    const subnet = ai ? subnetOf(ai.ip, ai.prefixLength) : '';
    const mid: Vec3 = [(a[0] + b[0]) / 2, 0.55, 0.15];
    return {
      id: l.id, from: l.a.device, to: l.b.device,
      points: [[a[0] + 0.62, 0.35, 0], mid, [b[0] - 0.62, 0.35, 0]],
      subnet, label: `${l.id} · ${subnet}`, labelPos: [mid[0], mid[1] + 0.3, mid[2]], active: hop?.linkId === l.id,
    };
  });

  const ifaces: SceneIface[] = t.links.flatMap((l) =>
    ([['a', l.a], ['b', l.b]] as const).map(([end, e]) => {
      const i = t.devices[e.device]?.ifaces.find((x) => x.name === e.iface);
      const p = pos(e.device);
      const other = pos(end === 'a' ? l.b.device : l.a.device);
      const dir = Math.sign(other[0] - p[0]);
      // Alternate above/below so neighbouring labels on one link never overlap.
      return {
        device: e.device, iface: e.iface, ip: i?.ip ?? '', mac: i?.mac ?? '',
        position: [p[0] + dir * 0.95, end === 'a' ? -0.55 : -1.15, 0] as Vec3,
        label: `${e.device}.${e.iface} ${i?.ip ?? ''}/${i?.prefixLength ?? ''}\n${i?.mac ?? ''}`,
      };
    }),
  );

  let packet: ScenePacket | null = null;
  const p = ev?.packetId ? s.packets[ev.packetId] : undefined;
  if (ev && depthOf(ev.tag) > 0) {
    const appBytes = !p ? (ev.bytes?.length ?? 0) : null;
    const shells = p ? shellsFor(ev, p.current, null) : [{ layer: 'app' as const, color: color.app, label: `Application · ${appBytes} B` }];
    const at = hop ? links.find((l) => l.id === hop.linkId) : null;
    const position: Vec3 = at?.points[1] ? [at.points[1][0], 1.1, 0] : [pos(ev.device)[0], 1.55, 0];
    packet = { id: ev.packetId ?? ev.id, position, shells, onLink: at?.id ?? null, bitStream: Boolean(at) && ev.type === 'transmit' };
  }

  return { template: t.id, layout: 'row', step: index, devices, ifaces, links, packet, summary };
}

/**
 * Same scene, laid out top→bottom for narrow stages: the row axis (x) becomes depth (z) seen from above,
 * device and link labels move to the left, interface labels to the right of their port.
 */
export function columnLayout(m: SceneModel): SceneModel {
  const swap = (v: Vec3): Vec3 => [v[2], v[1], v[0]];
  return {
    ...m,
    layout: 'column',
    devices: m.devices.map((d) => ({
      ...d,
      position: swap(d.position),
      labelPos: [-1.25, 0.3, d.position[0]],
      ports: d.ports.map((p) => ({ ...p, position: swap(p.position) })),
    })),
    links: m.links.map((l) => {
      const mid = l.points[1] ?? [0, 0, 0];
      return { ...l, points: l.points.map(swap), labelPos: [-1.35, 0.4, mid[0]] };
    }),
    ifaces: m.ifaces.map((i) => {
      const dev = m.devices.find((d) => d.id === i.device);
      const dx = dev ? Math.sign(i.position[0] - dev.position[0]) : 0;
      return { ...i, position: [1.75, 0.35, (dev?.position[0] ?? 0) + dx * 0.62] };
    }),
    packet: m.packet && { ...m.packet, position: swap(m.packet.position) },
  };
}
