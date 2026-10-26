import { hex, utf8 } from '../bytes.ts';
import { cookieValue, handleHttp, httpRequest, parseHttp } from './http.ts';
import { CRC32_RESIDUE, crc32, fcsBytes, pseudoHeader, verifyInternetChecksum } from '../checksum.ts';
import { encode, ethernetFrame, forwardPacket, packetFromFrame } from '../encode.ts';
import { prng, u16 } from '../prng.ts';
import type { Fault, Field, PacketKind, ScenarioConfig, TcpFlags } from '../schemas.ts';
import { EventQueue } from './queue.ts';
import {
  SnapshotTimeline,
  deepFreeze,
  initialState,
  reduce,
  type EndReason,
  type EndpointState,
  type SessionState,
  type SimState,
  type SimulationEvent,
} from './state.ts';
import { TCP_FLAG, checkTransition, flagNames, seqAdd, type TcpState } from './tcp.ts';
import { arpCaches, iface, instantiate, linkAt, lookup, templateEndpoints, type Endpoints, type Template, type TemplateId } from './topology.ts';
import { validateSimConfig } from './validate.ts';

// Discrete-event simulation. Pure: no React, GSAP, Three.js, timers or wall clock. Time is integer ns.

export type SimConfig = {
  seed: number;
  template: TemplateId;
  protocol: 'TCP' | 'UDP';
  udpChecksum: boolean;
  request: string;
  /** Client and server addresses; the server's echo app listens on `endpoints.server.port`. */
  endpoints: Endpoints;
  /** Destination port the client sends to (may differ from the server's listening port). */
  requestDstPort: number;
  /** Server application behaviour (raw mode): a custom echo that answers with this configured text. */
  reply: { enabled: boolean; text: string };
  /** Raw text, or an illustrative HTTP/1.1 exchange (TCP only). In HTTP mode `request`/`reply` are not used. */
  payloadMode: 'raw' | 'http';
  /** HTTP mode: the client's request and the server app's in-memory session table at the start of this connection. */
  http: { path: string; cookie: string | null; knownSessions: string[] };
  /** TCP normal close after the exchange. TIME-WAIT is an EDUCATIONAL timer, not an OS default (2×MSL is minutes). */
  close: { enabled: boolean; timeWaitMs: number };
  /** Teaching ISNs — deliberately fixed and readable, NOT secure random ISNs (RFC 9293 §3.4.1, RFC 6528). */
  tcp: { isnClient: number; isnServer: number };
  ttl: number;
  /** Initial retransmission timeout; doubles per retry (RFC 6298 §5.5 backoff). Fixed, not estimated. */
  rtoMs: number;
  maxRetries: number;
  maxEvents: number;
  maxDurationMs: number;
  faults: Fault[];
};

export function defaultSimConfig(template: TemplateId = 'same-lan', protocol: 'TCP' | 'UDP' = 'UDP'): SimConfig {
  const endpoints = templateEndpoints(template);
  return {
    seed: 42,
    template,
    protocol,
    udpChecksum: true,
    request: 'Hello',
    endpoints,
    requestDstPort: endpoints.server.port,
    reply: { enabled: true, text: 'World' },
    payloadMode: 'raw',
    http: { path: '/', cookie: null, knownSessions: [] },
    close: { enabled: false, timeWaitMs: 400 },
    tcp: { isnClient: 1000, isnServer: 5000 },
    ttl: 64,
    rtoMs: 200,
    maxRetries: 3,
    maxEvents: 400,
    maxDurationMs: 5000,
    faults: [],
  };
}

export const DEFAULT_SIM: Readonly<SimConfig> = deepFreeze(defaultSimConfig());

export type SimRun = {
  config: Readonly<SimConfig>;
  template: Template;
  events: readonly SimulationEvent[];
  timeline: SnapshotTimeline;
};

const NS_PER_MS = 1_000_000;
const ms = (ns: number) => ns / NS_PER_MS;
const round = (x: number) => Number(x.toFixed(6));
const u16At = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const u32At = (b: Uint8Array, i: number) => (((b[i] ?? 0) << 24) >>> 0) + ((b[i + 1] ?? 0) << 16) + ((b[i + 2] ?? 0) << 8) + (b[i + 3] ?? 0);
const macOf = (b: Uint8Array, at: number) => Array.from(b.slice(at, at + 6), (x) => x.toString(16).padStart(2, '0')).join(':');
const ipOf = (b: Uint8Array, at: number) => Array.from(b.slice(at, at + 4)).join('.');
const PREAMBLE_SFD = 8;
/** Application payload bytes inside an Ethernet/IPv4/TCP-or-UDP frame. */
function payloadLen(f: Uint8Array): number {
  const ihl = ((f[14] ?? 0x45) & 0x0f) * 4;
  const seg = (((f[16] ?? 0) << 8) | (f[17] ?? 0)) - ihl;
  const hdr = f[23] === 6 ? ((f[14 + ihl + 12] ?? 0x50) >> 4) * 4 : 8;
  return Math.max(0, seg - hdr);
}
const IFG = 12;
const NO_FLAGS: TcpFlags = { ack: false, psh: false, rst: false, syn: false, fin: false };

/** Field values for event details, keyed by field name. */
const fieldArgs = (fields: Field[], header: string): Record<string, string> =>
  Object.fromEntries(fields.filter((f) => f.header === header).map((f) => [f.name, f.display]));

type EvInput = Pick<SimulationEvent, 'device' | 'direction' | 'layer' | 'type' | 'tag' | 'explainKey'> &
  Partial<Pick<SimulationEvent, 'packetId' | 'iface' | 'bytes' | 'transition' | 'explainArgs' | 'causeId' | 'timing' | 'effects'>>;

type Seg = {
  kind: PacketKind;
  from: string;
  payload: Uint8Array;
  /** TCP control bits; ignored for UDP. */
  flags: TcpFlags;
  /** Sequence space consumed: SYN 1, data = byte count, pure ACK 0. */
  consumes: number;
  causeId: string | null;
};

export function simulate(input: SimConfig): SimRun {
  // Freeze a private copy: later edits to the caller's object cannot affect this run.
  const cfg: Readonly<SimConfig> = deepFreeze(structuredClone(input));
  const issues = validateSimConfig(cfg);
  if (issues.length) throw new Error(issues.map((i) => `${i.field}: ${i.message}`).join(' '));
  const t = instantiate(cfg.template, cfg.endpoints);
  const arp = arpCaches(t); // prepopulated; ARP exchange NOT BUILT
  const isTcp = cfg.protocol === 'TCP';
  const isHttp = cfg.payloadMode === 'http';
  const serverIp = t.devices[t.server]?.ifaces[0]?.ip ?? '';
  const request = isHttp ? utf8(httpRequest({ path: cfg.http.path, host: serverIp, cookie: cfg.http.cookie })) : utf8(cfg.request);
  /** The client closes only after the reply it expects (if any) has been processed. */
  const expectReply = request.length > 0 && (isHttp || cfg.reply.enabled);
  const r = prng(cfg.seed);
  const cPort = cfg.endpoints.client.port;
  const sPort = cfg.endpoints.server.port;
  const flowId = `${t.client}:${cPort}→${t.server}:${cfg.requestDstPort}/${cfg.protocol}`;
  /** Bound sockets per device (port → application). */
  const sockets: Record<string, Record<number, string>> = {
    [t.client]: { [cPort]: 'client app' },
    [t.server]: { [sPort]: isHttp ? 'HTTP app' : 'echo app' },
  };

  const session = (role: 'client' | 'server'): SessionState | null =>
    isHttp
      ? { known: role === 'server' ? [...cfg.http.knownSessions] : cfg.http.cookie === null ? [] : [cfg.http.cookie], verdict: null, cookieSent: null, issued: null }
      : null;
  const endpoint = (device: string, role: 'client' | 'server'): EndpointState => ({
    device, role, tcpState: 'CLOSED', iss: null, irs: null, sndUna: null, sndNxt: null, rcvNxt: null,
    sendBuffer: [], recvBuffer: [], deliveredBytes: 0, app: 'idle', timers: {}, session: session(role),
  });
  const init = initialState({ [t.client]: endpoint(t.client, 'client'), [t.server]: endpoint(t.server, 'server') });

  const q = new EventQueue();
  const events: SimulationEvent[] = [];
  let state: SimState = init;
  let now = 0;
  let lastEventNs = 0;
  let curSeq = 0;
  let ended = false;
  let pktCounter = 0;
  const maxNs = cfg.maxDurationMs * NS_PER_MS;
  const lossLeft = new Map<PacketKind, number>();
  for (const f of cfg.faults) if (f.kind === 'loss') lossLeft.set(f.packet, (lossLeft.get(f.packet) ?? 0) + f.count);
  // Targeted one-shot faults (drop / delay / corrupt), each consumed by the first transmission that matches it.
  const pending = cfg.faults.filter((f): f is Exclude<Fault, { kind: 'loss' }> => f.kind !== 'loss').map((f) => ({ ...f }));
  /** Links already traversed per packet id (the hop index of its next transmission). */
  const hopsDone = new Map<string, number>();
  const linkFree = new Map<string, number>();
  const lastSent = new Map<string, { pid: string; outIface: string }>();

  const ep = (d: string) => {
    const e = state.endpoints[d];
    if (!e) throw new Error(`no endpoint ${d}`);
    return e;
  };
  const pkt = (id: string) => {
    const p = state.packets[id];
    if (!p) throw new Error(`no packet ${id}`);
    return p;
  };

  function push(e: EvInput): string {
    const ev: SimulationEvent = deepFreeze({
      id: `e${events.length}`,
      index: events.length,
      virtualTimeNs: now,
      virtualTimeMs: ms(now),
      tieBreak: curSeq,
      flowId,
      packetId: null,
      iface: null,
      bytes: null,
      transition: null,
      explainArgs: {},
      causeId: null,
      timing: null,
      effects: [],
      ...e,
    });
    events.push(ev);
    state = reduce(state, ev);
    lastEventNs = now;
    return ev.id;
  }

  function emit(e: EvInput): string | null {
    if (ended) return null;
    if (events.length >= cfg.maxEvents - 1) {
      finish('event-cap');
      return null;
    }
    return push(e);
  }

  function finish(reason: EndReason) {
    if (ended) return;
    push({
      device: t.client, direction: 'local', layer: 'app', type: 'end', tag: `end:${reason}`, explainKey: `end.${reason}`,
      explainArgs: { atMs: round(ms(now)), cap: cfg.maxEvents, maxMs: cfg.maxDurationMs },
      effects: [{ k: 'end', reason, atMs: ms(now) }],
    });
    ended = true;
  }

  const schedule = (atNs: number, run: () => void, live?: () => boolean) => q.push(atNs, run, 0, live);

  const rejectEffects = (pid: string) => [
    { k: 'packet-patch' as const, id: pid, patch: { status: 'dropped' as const, rx: { transport: 'rejected' as const, app: 'pending' as const } } },
    { k: 'metric' as const, add: { drops: 1 } },
  ];

  // ---------- TCP state transitions (validated against the shared table) ----------
  function tcpState(dev: string, to: TcpState, patch: Partial<EndpointState>, causeId: string | null, explainKey: string, args: Record<string, string | number>) {
    const from = ep(dev).tcpState;
    checkTransition(from, to);
    return emit({
      device: dev, direction: 'local', layer: 'transport', type: 'tcp-state', tag: `tcp:state:${to}`, causeId,
      explainKey, explainArgs: { device: dev, from, to, ...args },
      transition: { machine: 'tcp', from, to },
      effects: [{ k: 'endpoint', device: dev, patch: { ...patch, tcpState: to } }],
    });
  }

  // ---------- application writes ----------
  function appWrite(dev: string, payload: Uint8Array, responding: boolean, causeId: string | null) {
    const me = ep(dev);
    const port = dev === t.client ? cPort : sPort;
    const dstPort = dev === t.client ? cfg.requestDstPort : cPort;
    const queued = isTcp && me.tcpState !== 'ESTABLISHED';
    const id = emit({
      device: dev, direction: 'local', layer: 'app', type: 'app-send', tag: responding ? 'app:respond' : 'app:send', causeId,
      explainKey: queued ? 'app.send.queued' : responding ? 'app.respond' : 'app.send',
      explainArgs: { device: dev, app: sockets[dev]?.[port] ?? 'app', bytes: payload.length, proto: cfg.protocol, srcPort: port, dstPort, text: new TextDecoder().decode(payload) },
      bytes: [...payload],
      transition: { machine: 'app', from: me.app, to: responding ? 'responded' : 'sent' },
      effects: [{ k: 'endpoint', device: dev, patch: { app: responding ? 'responded' : 'sent', ...(isTcp ? { sendBuffer: [...payload] } : {}) } }],
    });
    if (!isTcp) sendSegment({ kind: responding ? 'response' : 'data', from: dev, payload, flags: NO_FLAGS, consumes: 0, causeId: id });
    else flush(dev, id);
  }

  /** TCP: send queued app data once ESTABLISHED and nothing is outstanding (one data segment per direction). */
  function flush(dev: string, causeId: string | null) {
    const me = ep(dev);
    if (me.tcpState !== 'ESTABLISHED' || me.sendBuffer.length === 0 || me.sndUna !== me.sndNxt) return;
    sendSegment({
      kind: dev === t.client ? 'data' : 'response', from: dev, payload: Uint8Array.from(me.sendBuffer),
      flags: { ...NO_FLAGS, ack: true, psh: true }, consumes: me.sendBuffer.length, causeId,
    });
  }

  // ---------- sending ----------
  function sendSegment(s: Seg) {
    const { kind, from, payload, flags, consumes } = s;
    const toClient = from === t.server;
    const to = toClient ? t.client : t.server;
    const dstIf = t.devices[to]?.ifaces[0];
    if (!dstIf) throw new Error(`no iface on ${to}`);
    // Host routing: longest-prefix match picks egress + next hop; the ARP cache gives the next hop's MAC.
    const rc = lookup(t, from, dstIf.ip);
    if (!rc) throw new Error(`${from} has no route to ${dstIf.ip}`);
    const srcIf = iface(t, { device: from, iface: rc.iface });
    const nextMac = arp[from]?.[rc.nextHop];
    if (!nextMac) throw new Error(`${from} has no ARP entry for ${rc.nextHop}`);
    const me = ep(from);
    const pid = `p${++pktCounter}`;
    const srcPort = toClient ? sPort : cPort;
    const dstPort = toClient ? cPort : cfg.requestDstPort;
    const seq = me.sndNxt ?? 0;
    const ack = flags.ack ? (me.rcvNxt ?? 0) : 0;
    const pc: ScenarioConfig = {
      seed: cfg.seed + pktCounter,
      payload: { text: '' },
      transport: isTcp ? { protocol: 'TCP', window: 64240, flags, seq, ack } : { protocol: 'UDP', checksum: cfg.udpChecksum },
      src: { name: from, ip: srcIf.ip, mac: srcIf.mac, port: srcPort },
      dst: { name: to, ip: dstIf.ip, mac: dstIf.mac, port: dstPort },
      nextHopMac: nextMac,
      ttl: cfg.ttl,
      ipId: u16(r),
      dscp: 0,
      ecn: 0,
      dontFragment: true,
      faults: [],
    };
    const e = encode(pc, payload);
    const l4 = isTcp ? 'tcp' : 'udp';
    const unit = isTcp ? 'segment' : 'datagram';
    const flagText = isTcp ? flagNames(e.segment[13] ?? 0) : '';

    let cause = emit({
      device: from, direction: 'local', layer: 'transport', type: 'encap', tag: 'encap:transport', packetId: pid, causeId: s.causeId,
      explainKey: isTcp ? 'encap.transport.tcp' : 'encap.transport',
      explainArgs: { proto: cfg.protocol, unit, bytes: e.segment.length, flags: flagText, seq, ack, consumes, ...fieldArgs(e.fields, l4) },
      bytes: [...e.segment],
      effects: [
        {
          k: 'packet', id: pid,
          rec: { id: pid, kind, original: [...e.frame], current: [...e.frame], at: from, status: 'host', attempt: 0, rx: { transport: 'pending', app: 'pending' } },
        },
        // Sequence space: SYN 1, data its byte count, pure ACK 0.
        ...(isTcp ? [{ k: 'endpoint' as const, device: from, patch: { sndNxt: seqAdd(seq, consumes) } }] : []),
      ],
    });
    cause = emit({
      device: from, direction: 'local', layer: 'internet', type: 'encap', tag: 'encap:internet', packetId: pid, causeId: cause,
      explainKey: 'encap.internet', explainArgs: { bytes: e.packet.length, ttl: cfg.ttl, ...fieldArgs(e.fields, 'ipv4') }, bytes: [...e.packet],
    });
    cause = routeEvent(from, pid, dstIf.ip, rc, nextMac, cause);
    cause = emit({
      device: from, direction: 'local', layer: 'link', type: 'encap', tag: 'encap:link', packetId: pid, causeId: cause, iface: rc.iface,
      explainKey: 'encap.link',
      explainArgs: { bytes: e.frame.length, dstMac: nextMac, ...fieldArgs(e.fields, 'ethernet'), ...fieldArgs(e.fields, 'padding'), ...fieldArgs(e.fields, 'fcs') },
      bytes: [...e.frame],
      effects:
        kind === 'data' && !state.units.link
          ? [{ k: 'units', units: { app: [...e.payload], transport: [...e.segment], internet: [...e.packet], link: [...e.frame] }, fields: e.fields }]
          : [],
    });
    if (isTcp && consumes > 0) {
      lastSent.set(from, { pid, outIface: rc.iface });
      armTimer(from, 0, cause, pid);
    }
    const frame = e.frame;
    const c = cause;
    schedule(now + (t.devices[from]?.processingNs ?? 0), () => transmit(pid, frame, from, rc.iface, c));
    return cause;
  }

  function routeEvent(dev: string, pid: string, dst: string, rc: NonNullable<ReturnType<typeof lookup>>, mac: string, causeId: string | null) {
    return emit({
      device: dev, iface: rc.iface, direction: 'local', layer: 'internet', type: 'route', tag: 'route:lookup', packetId: pid, causeId,
      explainKey: 'route.lookup',
      explainArgs: { device: dev, dst, route: rc.text, nextHop: rc.nextHop, iface: rc.iface, mac, arp: 'prepopulated ARP cache (ARP exchange NOT BUILT)' },
    });
  }

  function transmit(pid: string, frame: Uint8Array, from: string, outIface: string, causeId: string | null) {
    const { link, out, in: inn } = linkAt(t, from, outIface);
    const to = inn.device;
    const key = `${link.id}:${from}`;
    const freeAt = linkFree.get(key) ?? 0;
    if (freeAt > now) {
      schedule(freeAt, () => transmit(pid, frame, from, outIface, causeId)); // link busy: queue (FIFO by seq)
      return;
    }
    const onLinkBytes = PREAMBLE_SFD + frame.length + IFG;
    const bits = onLinkBytes * 8;
    const serNs = Math.ceil((bits * 1e9) / link.bps);
    const endNs = now + serNs;
    const arrivalNs = endNs + link.propagationNs;
    linkFree.set(key, endNs);
    const hop = { packetId: pid, linkId: link.id, from, to, sendStartMs: ms(now), sendEndMs: ms(endNs), arrivalMs: ms(arrivalNs) };
    const rec = pkt(pid);
    const hopIdx = hopsDone.get(pid) ?? 0;
    hopsDone.set(pid, hopIdx + 1);
    // Application bytes put on the wire by an endpoint (every attempt counts; unique delivery is `deliveredBytes`).
    const appSent = hopIdx === 0 && (from === t.client || from === t.server) ? payloadLen(frame) : 0;
    const id = emit({
      device: from, iface: out.iface, direction: 'out', layer: 'link', type: 'transmit', tag: `hop:${from}:egress`, packetId: pid, causeId,
      bytes: [...frame],
      timing: {
        sendStartMs: ms(now), sendEndMs: ms(endNs), arrivalMs: ms(arrivalNs), serializationMs: ms(serNs), propagationMs: ms(link.propagationNs),
        frameBytes: frame.length, onLinkBytes, bits, bps: link.bps,
      },
      explainKey: 'transmit',
      explainArgs: { device: from, iface: out.iface, frameBytes: frame.length, onLinkBytes, link: link.id, serMs: round(ms(serNs)), propMs: round(ms(link.propagationNs)) },
      transition: { machine: 'packet', from: pkt(pid).status, to: 'link' },
      effects: [
        { k: 'hop', hop },
        { k: 'packet-patch', id: pid, patch: { status: 'link', at: link.id, current: [...frame] } },
        { k: 'metric', add: { framesSent: 1, frameBytesSent: frame.length, onLinkBytesSent: onLinkBytes, linkBusyMs: ms(serNs), appBytesSent: appSent } },
      ],
    });
    if (!id) return;
    const kind = rec.kind;
    const fi = pending.findIndex((f) => f.target.packet === kind && f.target.attempt === rec.attempt && f.target.hop === hopIdx);
    const fault = fi >= 0 ? pending.splice(fi, 1)[0] : undefined;
    if (fault) {
      const base = { device: from, iface: out.iface, direction: 'out' as const, layer: 'link' as const, type: 'fault' as const, packetId: pid, causeId: id };
      const where = { link: link.id, hop: hopIdx, attempt: rec.attempt, kind };
      if (fault.kind === 'drop') {
        const f = emit({ ...base, tag: 'fault:drop', explainKey: 'fault.drop', explainArgs: { ...where, to } });
        schedule(arrivalNs, () =>
          emit({
            device: to, iface: inn.iface, direction: 'in', layer: 'link', type: 'drop', tag: 'drop:fault', packetId: pid, causeId: f,
            explainKey: 'drop.fault', explainArgs: { device: to, link: link.id, kind },
            transition: { machine: 'packet', from: 'link', to: 'dropped' },
            effects: [...clearHop(pid), ...rejectEffects(pid)],
          }),
        );
        return;
      }
      if (fault.kind === 'delay') {
        const f = emit({ ...base, tag: 'fault:delay', explainKey: 'fault.delay', explainArgs: { ...where, delayMs: fault.delayMs, to } });
        const d = Math.round(fault.delayMs * NS_PER_MS);
        schedule(arrivalNs + d, () => arrive(pid, frame, to, inn.iface, f ?? id));
        return;
      }
      // Corruption happens on the wire, after the sender computed every checksum and the FCS.
      const ihl = ((frame[14] ?? 0x45) & 0x0f) * 4;
      const segStart = 14 + ihl;
      const segLen = u16At(frame, 16) - ihl;
      if (fault.offset >= segLen) {
        emit({ ...base, tag: 'fault:skipped', explainKey: 'fault.skipped', explainArgs: { ...where, offset: fault.offset, segLen } });
      } else {
        const c = Uint8Array.from(frame);
        const at = segStart + fault.offset;
        const before = c[at] ?? 0;
        c[at] = before ^ (1 << fault.bit);
        if (fault.mode === 'transport') c.set(fcsBytes(crc32(c.subarray(0, c.length - 4))), c.length - 4); // valid outer FCS
        const f = emit({
          ...base, tag: `fault:corrupt:${fault.mode}`, explainKey: `fault.corrupt.${fault.mode}`,
          explainArgs: { ...where, to, frameByte: at, offset: fault.offset, bit: fault.bit, from: `0x${hex(before)}`, into: `0x${hex(c[at] ?? 0)}` },
          bytes: [...c],
          effects: [{ k: 'packet-patch', id: pid, patch: { current: [...c], corrupt: { frameByte: at, bit: fault.bit, mode: fault.mode } } }],
        });
        schedule(arrivalNs, () => arrive(pid, c, to, inn.iface, f ?? id));
        return;
      }
    }
    const left = lossLeft.get(kind) ?? 0;
    // Loss faults apply to the sender's own link (first hop) only.
    if (t.devices[from]?.kind === 'host' && left > 0) {
      lossLeft.set(kind, left - 1);
      schedule(arrivalNs, () =>
        emit({
          device: to, iface: inn.iface, direction: 'in', layer: 'link', type: 'drop', tag: 'drop', packetId: pid, causeId: id,
          explainKey: 'drop', explainArgs: { link: link.id },
          transition: { machine: 'packet', from: 'link', to: 'dropped' },
          effects: [...clearHop(pid), ...rejectEffects(pid)],
        }),
      );
      return;
    }
    schedule(arrivalNs, () => arrive(pid, frame, to, inn.iface, id));
  }

  const clearHop = (pid: string) => (state.activeHop?.packetId === pid ? [{ k: 'hop' as const, hop: null }] : []);

  function reject(dev: string, pid: string, causeId: string | null, layer: 'link' | 'internet' | 'transport', reason: string) {
    emit({
      device: dev, direction: 'in', layer, type: 'drop', tag: `drop:${layer}`, packetId: pid, causeId,
      explainKey: 'drop.verify', explainArgs: { device: dev, reason },
      transition: { machine: 'packet', from: pkt(pid).status, to: 'dropped' },
      effects: rejectEffects(pid),
    });
  }

  function arrive(pid: string, frame: Uint8Array, dev: string, ifName: string, causeId: string) {
    const d = t.devices[dev];
    const myIf = d?.ifaces.find((x) => x.name === ifName);
    if (!d || !myIf) return;
    let cause = emit({
      device: dev, iface: ifName, direction: 'in', layer: 'link', type: 'arrive', tag: `hop:${dev}:ingress`, packetId: pid, causeId,
      bytes: [...frame], explainKey: 'arrive', explainArgs: { device: dev, iface: ifName },
      transition: { machine: 'packet', from: 'link', to: d.kind },
      effects: [...clearHop(pid), { k: 'packet-patch', id: pid, patch: { status: d.kind === 'router' ? 'router' : 'host', at: dev } }],
    });

    // Link verification: FCS and destination MAC.
    const fcsOk = crc32(frame) === CRC32_RESIDUE;
    const dstMac = macOf(frame, 0);
    const macOk = dstMac === myIf.mac.toLowerCase();
    if (!fcsOk || !macOk) return reject(dev, pid, cause, 'link', !fcsOk ? 'FCS mismatch' : `destination MAC ${dstMac} is not ${myIf.mac}`);
    cause = emit({
      device: dev, iface: ifName, direction: 'in', layer: 'link', type: 'verify', tag: 'verify:link', packetId: pid, causeId: cause,
      explainKey: 'verify.link', explainArgs: { dstMac, fcs: 'CRC-32 residue 0x2144DF1C ✓' },
    });
    const packet = packetFromFrame(frame);
    cause = emit({
      device: dev, iface: ifName, direction: 'in', layer: 'link', type: 'decap', tag: 'decap:link', packetId: pid, causeId: cause,
      bytes: [...packet], explainKey: 'decap.link', explainArgs: { bytes: packet.length, padding: frame.length - 18 - packet.length },
    });

    // IPv4 validation (routers and hosts).
    const ihl = ((packet[0] ?? 0) & 0x0f) * 4;
    const dstIp = ipOf(packet, 16);
    const ipOk = (packet[0] ?? 0) >> 4 === 4 && verifyInternetChecksum(packet.slice(0, ihl));
    if (!ipOk) return reject(dev, pid, cause, 'internet', 'IPv4 version or header checksum invalid');
    if (d.kind === 'host' && dstIp !== myIf.ip) return reject(dev, pid, cause, 'internet', `destination ${dstIp} is not this host`);
    cause = emit({
      device: dev, direction: 'in', layer: 'internet', type: 'verify', tag: 'verify:internet', packetId: pid, causeId: cause,
      explainKey: 'verify.internet', explainArgs: { dst: dstIp, ttl: packet[8] ?? 0, checksum: `0x${u16At(packet, 10).toString(16).toUpperCase().padStart(4, '0')} ✓` },
    });
    if (d.kind === 'router') {
      const c = cause;
      schedule(now + d.processingNs, () => forward(pid, packet, dev, c));
      return;
    }

    const seg = packet.slice(ihl);
    const unit = isTcp ? 'segment' : 'datagram';
    cause = emit({
      device: dev, direction: 'in', layer: 'internet', type: 'decap', tag: 'decap:internet', packetId: pid, causeId: cause,
      bytes: [...seg], explainKey: 'decap.internet', explainArgs: { dst: dstIp, bytes: seg.length, unit },
    });

    // Transport validation: length and checksum over the pseudo-header.
    const proto = packet[9] ?? 0;
    const ph = pseudoHeader(packet.slice(12, 16), packet.slice(16, 20), proto, seg.length);
    let tKey: string;
    if (proto === 17) {
      const len = u16At(seg, 4);
      if (len !== seg.length) return reject(dev, pid, cause, 'transport', `UDP length ${len} ≠ ${seg.length} received`);
      const cs = u16At(seg, 6);
      if (cs !== 0 && !verifyInternetChecksum(ph, seg)) return reject(dev, pid, cause, 'transport', 'UDP checksum mismatch');
      tKey = cs === 0 ? 'verify.transport.udp-none' : 'verify.transport.udp';
    } else {
      if (!verifyInternetChecksum(ph, seg)) return reject(dev, pid, cause, 'transport', 'TCP checksum mismatch');
      tKey = 'verify.transport.tcp';
    }
    const dstPort = u16At(seg, 2);
    cause = emit({
      device: dev, direction: 'in', layer: 'transport', type: 'verify', tag: 'verify:transport', packetId: pid, causeId: cause,
      explainKey: tKey,
      explainArgs: {
        length: seg.length,
        checksum: `0x${u16At(seg, isTcp ? 16 : 6).toString(16).toUpperCase().padStart(4, '0')}`,
        ...(isTcp ? { flags: flagNames(seg[13] ?? 0), seq: u32At(seg, 4), ack: u32At(seg, 8) } : {}),
      },
    });

    // Socket selection by destination port: only the bound application may receive it.
    const app = sockets[dev]?.[dstPort];
    if (!app) {
      emit({
        device: dev, direction: 'in', layer: 'transport', type: 'socket', tag: 'socket:none', packetId: pid, causeId: cause,
        explainKey: isTcp ? 'socket.none.tcp' : 'socket.none.udp', explainArgs: { port: dstPort, device: dev, bound: Object.keys(sockets[dev] ?? {}).join(', ') },
        transition: { machine: 'packet', from: 'host', to: 'discarded' },
        effects: [{ k: 'packet-patch', id: pid, patch: { status: 'discarded', rx: { transport: 'rejected', app: 'pending' } } }],
      });
      return;
    }
    cause = emit({
      device: dev, direction: 'in', layer: 'transport', type: 'socket', tag: 'socket:select', packetId: pid, causeId: cause,
      explainKey: 'socket.select', explainArgs: { port: dstPort, app },
    });
    const hdr = isTcp ? ((seg[12] ?? 0x50) >> 4) * 4 : 8;
    const payload = seg.slice(hdr);
    cause = emit({
      device: dev, direction: 'in', layer: 'transport', type: 'decap', tag: 'decap:transport', packetId: pid, causeId: cause,
      bytes: [...payload], explainKey: 'decap.transport', explainArgs: { proto: cfg.protocol, bytes: payload.length, port: dstPort, app },
      effects: [{ k: 'packet-patch', id: pid, patch: { rx: { transport: 'accepted', app: 'pending' } } }],
    });
    const c = cause;
    schedule(now + d.processingNs, () => (isTcp ? receiveTcp(pid, dev, seg, payload, app, c) : receiveUdp(pid, dev, payload, app, c)));
  }

  /** Router forwarding (RFC 1812 §5.3.1): TTL check/decrement, header checksum, route lookup, new frame. No NAT. */
  function forward(pid: string, packet: Uint8Array, dev: string, causeId: string | null) {
    const ttl = packet[8] ?? 0;
    const fwd = forwardPacket(packet);
    if (!fwd) {
      emit({
        device: dev, direction: 'local', layer: 'internet', type: 'drop', tag: 'drop:ttl', packetId: pid, causeId,
        explainKey: 'drop.ttl', explainArgs: { device: dev, ttl },
        transition: { machine: 'packet', from: 'router', to: 'dropped' },
        effects: rejectEffects(pid),
      });
      return;
    }
    const dst = ipOf(packet, 16);
    const rc = lookup(t, dev, dst);
    const mac = rc ? arp[dev]?.[rc.nextHop] : undefined;
    if (!rc || !mac) return reject(dev, pid, causeId, 'internet', `no route to ${dst} (ICMP Destination Unreachable NOT BUILT)`);
    let cause = routeEvent(dev, pid, dst, rc, mac, causeId);
    const outIf = iface(t, { device: dev, iface: rc.iface });
    cause = emit({
      device: dev, iface: rc.iface, direction: 'local', layer: 'internet', type: 'forward', tag: `hop:${dev}:forward`, packetId: pid, causeId: cause,
      bytes: [...fwd], explainKey: 'forward',
      explainArgs: {
        device: dev, ttlFrom: ttl, ttlTo: fwd[8] ?? 0, iface: rc.iface,
        csFrom: `0x${u16At(packet, 10).toString(16).toUpperCase().padStart(4, '0')}`,
        csTo: `0x${u16At(fwd, 10).toString(16).toUpperCase().padStart(4, '0')}`,
      },
      transition: { machine: 'packet', from: `TTL ${ttl}`, to: `TTL ${fwd[8]}` },
    });
    const { frame } = ethernetFrame(fwd, mac, outIf.mac);
    cause = emit({
      device: dev, iface: rc.iface, direction: 'local', layer: 'link', type: 'encap', tag: 'encap:link', packetId: pid, causeId: cause,
      bytes: [...frame], explainKey: 'encap.link', explainArgs: { bytes: frame.length, dstMac: mac, 'Source MAC': outIf.mac },
      effects: [{ k: 'packet-patch', id: pid, patch: { current: [...frame] } }],
    });
    transmit(pid, frame, dev, rc.iface, cause);
  }

  // ---------- receiving ----------
  function receiveUdp(pid: string, dev: string, payload: Uint8Array, app: string, causeId: string | null) {
    const d = deliver(pid, dev, payload, app, causeId);
    processApp(pid, dev, app, d);
  }

  const ignored = (dev: string, pid: string, causeId: string | null, why: string) =>
    emit({
      device: dev, direction: 'in', layer: 'transport', type: 'discard', tag: 'tcp:ignored', packetId: pid, causeId,
      explainKey: 'tcp.ignored', explainArgs: { device: dev, state: ep(dev).tcpState, why },
      effects: [{ k: 'packet-patch', id: pid, patch: { status: 'discarded' } }],
    });

  function receiveTcp(pid: string, dev: string, seg: Uint8Array, payload: Uint8Array, app: string, causeId: string | null) {
    const kind = pkt(pid).kind;
    const bits = seg[13] ?? 0;
    const SYN = (bits & TCP_FLAG.SYN) !== 0;
    const ACK = (bits & TCP_FLAG.ACK) !== 0;
    const FIN = (bits & TCP_FLAG.FIN) !== 0;
    const seq = u32At(seg, 4);
    const ack = u32At(seg, 8);
    let cause = causeId;
    const me = ep(dev);

    switch (me.tcpState) {
      case 'LISTEN': {
        if (!SYN || ACK) return ignored(dev, pid, cause, 'expected SYN (RST NOT BUILT)');
        const iss = cfg.tcp.isnServer;
        cause = tcpState(dev, 'SYN-RECEIVED', { irs: seq, rcvNxt: seqAdd(seq, 1), iss, sndUna: iss, sndNxt: iss }, cause, 'tcp.syn-rcvd', { seq, rcvNxt: seqAdd(seq, 1) });
        sendSegment({ kind: 'syn-ack', from: dev, payload: new Uint8Array(), flags: { ...NO_FLAGS, syn: true, ack: true }, consumes: 1, causeId: cause });
        return;
      }
      case 'SYN-SENT': {
        if (!SYN || !ACK || ack !== me.sndNxt) return ignored(dev, pid, cause, 'expected SYN, ACK acknowledging our SYN');
        cause = processAck(dev, ack, false, pid, cause);
        cause = tcpState(dev, 'ESTABLISHED', { irs: seq, rcvNxt: seqAdd(seq, 1) }, cause, 'tcp.established.client', { seq, ack });
        cause = sendSegment({ kind: 'hs-ack', from: dev, payload: new Uint8Array(), flags: { ...NO_FLAGS, ack: true }, consumes: 0, causeId: cause });
        flush(dev, cause);
        tryClose(dev, cause); // no-data close: nothing queued, so the client may close right away
        return;
      }
      case 'SYN-RECEIVED': {
        if (SYN) return ignored(dev, pid, cause, 'duplicate SYN while SYN-RECEIVED');
        if (!ACK || ack !== me.sndNxt) return ignored(dev, pid, cause, 'ACK does not acknowledge our SYN');
        cause = processAck(dev, ack, false, pid, cause);
        cause = tcpState(dev, 'ESTABLISHED', {}, cause, 'tcp.established.server', { ack });
        if (payload.length === 0 && !FIN) return; // the handshake ACK carries no data
        break; // data (or FIN) riding on the ACK: continue as ESTABLISHED
      }
      case 'ESTABLISHED':
      case 'FIN-WAIT-1':
      case 'FIN-WAIT-2':
      case 'CLOSE-WAIT':
      case 'LAST-ACK':
      case 'TIME-WAIT':
        break;
      default:
        return ignored(dev, pid, cause, 'connection is CLOSED (RST NOT BUILT)');
    }

    const st = ep(dev).tcpState;
    if (SYN) {
      if (st !== 'ESTABLISHED') return ignored(dev, pid, cause, `SYN in ${st}`);
      // Retransmitted SYN-ACK after our handshake ACK was lost: not acceptable → re-ACK (RFC 9293 §3.10.7.4).
      cause = emit({
        device: dev, direction: 'in', layer: 'transport', type: 'discard', tag: 'tcp:duplicate', packetId: pid, causeId: cause,
        explainKey: 'tcp.dup-syn', explainArgs: { seq },
        effects: [{ k: 'packet-patch', id: pid, patch: { status: 'discarded' } }],
      });
      sendSegment({ kind: 'hs-ack', from: dev, payload: new Uint8Array(), flags: { ...NO_FLAGS, ack: true }, consumes: 0, causeId: cause });
      return;
    }
    // Only states that still receive data accept new bytes (RFC 9293 §3.10.7.4, "seventh, process the segment text").
    const receiving = st === 'ESTABLISHED' || st === 'FIN-WAIT-1' || st === 'FIN-WAIT-2';
    let fresh = false;
    if (payload.length > 0) {
      if (receiving && seq === ep(dev).rcvNxt) {
        cause = deliver(pid, dev, payload, app, cause);
        fresh = true;
      } else {
        cause = emit({
          device: dev, direction: 'in', layer: 'transport', type: 'discard', tag: 'tcp:duplicate', packetId: pid, causeId: cause,
          explainKey: 'discard.duplicate', explainArgs: { seq },
          effects: [{ k: 'packet-patch', id: pid, patch: { status: 'discarded' } }],
        });
      }
    }
    if (ACK) {
      const nxt = ep(dev).sndNxt;
      if ((st === 'FIN-WAIT-1' || st === 'LAST-ACK') && ack === nxt && ep(dev).sndUna !== nxt) {
        cause = processAck(dev, ack, false, pid, cause);
        if (st === 'LAST-ACK') {
          tcpState(dev, 'CLOSED', {}, cause, 'tcp.closed.last-ack', { ack });
          return;
        }
        cause = tcpState(dev, 'FIN-WAIT-2', {}, cause, 'tcp.fin-wait-2', { ack });
      } else cause = processAck(dev, ack, payload.length > 0 || FIN, pid, cause);
    }
    if (FIN) return receiveFin(pid, dev, seqAdd(seq, payload.length), cause);
    if (payload.length > 0) {
      // No delayed ACK (pedagogical choice): every data segment is acknowledged immediately.
      sendSegment({ kind: kind === 'data' ? 'ack' : 'response-ack', from: dev, payload: new Uint8Array(), flags: { ...NO_FLAGS, ack: true }, consumes: 0, causeId: cause });
      if (fresh) processApp(pid, dev, app, cause);
    } else if (dev === t.client && !expectReply) tryClose(dev, cause);
  }

  // ---------- close (RFC 9293 §3.6, normal close sequence) ----------
  /** The client app closes once its data is acknowledged and any expected reply has been processed. */
  function tryClose(dev: string, causeId: string | null) {
    const me = ep(dev);
    if (!isTcp || !cfg.close.enabled || dev !== t.client || me.tcpState !== 'ESTABLISHED') return;
    if (me.sendBuffer.length > 0 || me.sndUna !== me.sndNxt || (expectReply && me.app !== 'got-response')) return;
    activeClose(dev, causeId);
  }

  /** CLOSE: send FIN (consumes one sequence number). Client = active close; server = its half of the passive close. */
  function activeClose(dev: string, causeId: string | null) {
    const client = dev === t.client;
    const seq = ep(dev).sndNxt ?? 0;
    const c = emit({
      device: dev, direction: 'local', layer: 'app', type: 'session', tag: 'app:close', causeId,
      explainKey: client ? 'app.close.active' : 'app.close.passive', explainArgs: { device: dev, app: sockets[dev]?.[client ? cPort : sPort] ?? 'app' },
    });
    const fin = sendSegment({ kind: client ? 'fin-client' : 'fin-server', from: dev, payload: new Uint8Array(), flags: { ...NO_FLAGS, ack: true, fin: true }, consumes: 1, causeId: c });
    tcpState(dev, client ? 'FIN-WAIT-1' : 'LAST-ACK', {}, fin, client ? 'tcp.fin-wait-1' : 'tcp.last-ack', { seq, next: seqAdd(seq, 1) });
  }

  function receiveFin(pid: string, dev: string, finSeq: number, causeId: string | null) {
    const me = ep(dev);
    const st = me.tcpState;
    const rcv = me.rcvNxt ?? 0;
    const ackKind = dev === t.client ? 'ack-fin-server' : 'ack-fin-client';
    const ackFin = (c: string | null) => sendSegment({ kind: ackKind, from: dev, payload: new Uint8Array(), flags: { ...NO_FLAGS, ack: true }, consumes: 0, causeId: c });
    if (finSeq === rcv && (st === 'ESTABLISHED' || st === 'FIN-WAIT-2')) {
      const next = seqAdd(rcv, 1); // the FIN consumes one sequence number
      const toWait = st === 'ESTABLISHED';
      const c = tcpState(dev, toWait ? 'CLOSE-WAIT' : 'TIME-WAIT', { rcvNxt: next }, causeId, toWait ? 'tcp.close-wait' : 'tcp.time-wait', { seq: finSeq, rcvNxt: next });
      const a = ackFin(c);
      if (toWait) {
        // The app reads end-of-stream, then closes its own side after its processing delay.
        schedule(now + (t.devices[dev]?.appResponseNs ?? 0), () => {
          if (ep(dev).tcpState === 'CLOSE-WAIT') activeClose(dev, a);
        });
      } else armTimeWait(dev, a);
      return;
    }
    if (seqAdd(finSeq, 1) === rcv && (st === 'CLOSE-WAIT' || st === 'LAST-ACK' || st === 'TIME-WAIT')) {
      // Retransmitted FIN: our ACK was lost. Re-ACK; TIME-WAIT restarts its timer (RFC 9293 §3.10.7.4).
      const c = emit({
        device: dev, direction: 'in', layer: 'transport', type: 'discard', tag: 'tcp:duplicate-fin', packetId: pid, causeId,
        explainKey: 'tcp.dup-fin', explainArgs: { seq: finSeq, state: st },
        effects: [{ k: 'packet-patch', id: pid, patch: { status: 'discarded' } }],
      });
      const a = ackFin(c);
      if (st === 'TIME-WAIT') armTimeWait(dev, a);
      return;
    }
    if (st === 'FIN-WAIT-1') return ignored(dev, pid, causeId, 'FIN before our FIN was acknowledged: simultaneous close (CLOSING) is NOT BUILT');
    return ignored(dev, pid, causeId, `unexpected FIN seq ${finSeq}`);
  }

  function armTimeWait(dev: string, causeId: string | null) {
    const prev = ep(dev).timers['time-wait'];
    const gen = (prev?.generation ?? 0) + 1;
    const twNs = cfg.close.timeWaitMs * NS_PER_MS;
    emit({
      device: dev, direction: 'local', layer: 'transport', type: 'timer-set', tag: 'timer:set:time-wait', causeId,
      explainKey: prev ? 'timer.time-wait.restart' : 'timer.time-wait', explainArgs: { ms: cfg.close.timeWaitMs, gen },
      transition: { machine: 'timer', from: prev?.armed ? 'armed' : 'idle', to: 'armed' },
      effects: [{ k: 'timer', device: dev, name: 'time-wait', timer: { generation: gen, armed: true, deadlineMs: ms(now + twNs), retries: 0 } }],
    });
    schedule(
      now + twNs,
      () => {
        const tm = ep(dev).timers['time-wait'];
        if (!tm) return;
        const id = emit({
          device: dev, direction: 'local', layer: 'transport', type: 'timer-fire', tag: 'timer:fire:time-wait',
          explainKey: 'timer.time-wait.fire', explainArgs: { ms: cfg.close.timeWaitMs },
          transition: { machine: 'timer', from: 'armed', to: 'expired' },
          effects: [{ k: 'timer', device: dev, name: 'time-wait', timer: { ...tm, armed: false, deadlineMs: null } }],
        });
        tcpState(dev, 'CLOSED', {}, id, 'tcp.closed.time-wait', { ms: cfg.close.timeWaitMs });
      },
      live(dev, gen, 'time-wait'),
    );
  }

  function deliver(pid: string, dev: string, payload: Uint8Array, app: string, causeId: string | null) {
    const me = ep(dev);
    const server = dev === t.server;
    return emit({
      device: dev, direction: 'in', layer: 'app', type: 'deliver', tag: 'deliver:app', packetId: pid, causeId,
      bytes: [...payload],
      explainKey: 'deliver',
      explainArgs: { bytes: payload.length, device: dev, app, total: me.deliveredBytes + payload.length, text: new TextDecoder().decode(payload) },
      transition: { machine: 'app', from: me.app, to: server ? 'received' : 'got-response' },
      effects: [
        {
          k: 'endpoint', device: dev,
          patch: {
            recvBuffer: [...me.recvBuffer, ...payload],
            deliveredBytes: me.deliveredBytes + payload.length,
            app: server ? 'received' : 'got-response',
            ...(isTcp ? { rcvNxt: seqAdd(me.rcvNxt ?? 0, payload.length) } : {}),
          },
        },
        { k: 'packet-patch', id: pid, patch: { status: 'delivered' } },
        { k: 'metric', add: { deliveredBytes: payload.length } },
      ],
    });
  }

  /** The application reads and handles the data after its delay; the echo app then writes its configured reply. */
  function processApp(pid: string, dev: string, app: string, causeId: string | null) {
    const delay = t.devices[dev]?.appResponseNs ?? 0;
    schedule(now + delay, () => {
      const server = dev === t.server;
      const me = ep(dev);
      const willReply = server && (isHttp || cfg.reply.enabled) && me.app !== 'responded';
      const text = new TextDecoder().decode(Uint8Array.from(me.recvBuffer));
      // HTTP mode: the server's in-memory session table decides; the client stores any Set-Cookie in its demo jar.
      const h = isHttp && server && me.session ? handleHttp(text, me.session.known, cfg.seed) : null;
      const setCookie = isHttp && !server ? cookieValue(parseHttp(text)?.headers['set-cookie']) : null;
      const sessionPatch: SessionState | null = h
        ? { known: h.known, verdict: h.verdict, cookieSent: h.cookieSent, issued: h.issued }
        : setCookie !== null && me.session
          ? { ...me.session, known: [setCookie], issued: setCookie }
          : null;
      const id = emit({
        device: dev, direction: 'local', layer: 'app', type: 'app-process', tag: 'app:processed', packetId: pid, causeId,
        explainKey: h ? `http.${h.verdict}` : setCookie !== null ? 'http.cookie-stored' : willReply ? 'app.processed.reply' : server ? 'app.processed.noreply' : 'app.processed',
        explainArgs: { device: dev, app, delayMs: round(ms(delay)), cookie: h?.cookieSent ?? 'none', issued: h?.issued ?? setCookie ?? '' },
        transition: server ? { machine: 'app', from: me.app, to: 'processed' } : null,
        effects: [
          { k: 'packet-patch', id: pid, patch: { rx: { transport: 'accepted', app: 'processed' } } },
          ...(server ? [{ k: 'endpoint' as const, device: dev, patch: { app: 'processed' as const } }] : []),
          ...(sessionPatch ? [{ k: 'endpoint' as const, device: dev, patch: { session: sessionPatch } }] : []),
        ],
      });
      if (willReply) appWrite(dev, h ? utf8(h.response) : utf8(cfg.reply.text), true, id);
      else if (!server) tryClose(dev, id);
    });
  }

  function processAck(dev: string, ack: number, piggyback: boolean, pid: string, causeId: string | null): string | null {
    const me = ep(dev);
    const una = me.sndUna ?? 0;
    const nxt = me.sndNxt ?? 0;
    if (una !== nxt && ack === nxt) {
      const n = seqAdd(nxt, -una);
      // One outstanding segment at a time: either our SYN (SND.UNA = ISS) or our data.
      const synAcked = una === me.iss;
      const finAcked = me.tcpState === 'FIN-WAIT-1' || me.tcpState === 'LAST-ACK';
      const id = emit({
        device: dev, direction: 'in', layer: 'transport', type: 'ack', tag: 'ack', packetId: pid, causeId,
        explainKey: 'ack.new', explainArgs: { ack, n, what: synAcked ? 'the SYN' : finAcked ? 'the FIN' : `${n} B of data` },
        // Queued app data stays buffered when only the SYN is acknowledged.
        effects: [{ k: 'endpoint', device: dev, patch: { sendBuffer: synAcked ? me.sendBuffer : [], sndUna: ack } }],
      });
      cancelTimer(dev, id);
      return id;
    }
    if (piggyback) return causeId; // ACK field on a data segment that acknowledges nothing new: nothing to report
    return emit({
      device: dev, direction: 'in', layer: 'transport', type: 'ack', tag: 'ack:duplicate', packetId: pid, causeId,
      explainKey: 'ack.duplicate', explainArgs: { ack },
    });
  }

  // ---------- timers (generation tokens; TCP only) ----------
  const live = (dev: string, gen: number, name = 'rto') => () => {
    const tm = state.endpoints[dev]?.timers[name];
    return !!tm && tm.armed && tm.generation === gen;
  };

  function armTimer(dev: string, retries: number, causeId: string | null, pid: string) {
    const gen = (ep(dev).timers.rto?.generation ?? 0) + 1;
    const rtoNs = cfg.rtoMs * NS_PER_MS * 2 ** retries;
    emit({
      device: dev, direction: 'local', layer: 'transport', type: 'timer-set', tag: 'timer:set:rto', causeId, packetId: pid,
      explainKey: 'timer.set', explainArgs: { rtoMs: round(ms(rtoNs)), gen },
      transition: { machine: 'timer', from: 'idle', to: 'armed' },
      effects: [{ k: 'timer', device: dev, name: 'rto', timer: { generation: gen, armed: true, deadlineMs: ms(now + rtoNs), retries } }],
    });
    schedule(now + rtoNs, () => fireTimer(dev, gen), live(dev, gen));
  }

  function cancelTimer(dev: string, causeId: string | null) {
    const tm = ep(dev).timers.rto;
    if (!tm?.armed) return;
    emit({
      device: dev, direction: 'local', layer: 'transport', type: 'timer-cancel', tag: 'timer:cancel:rto', causeId,
      explainKey: 'timer.cancel', explainArgs: { gen: tm.generation + 1 },
      transition: { machine: 'timer', from: 'armed', to: 'idle' },
      // Bumping the generation makes any pending callback for the old one a no-op.
      effects: [{ k: 'timer', device: dev, name: 'rto', timer: { ...tm, generation: tm.generation + 1, armed: false, deadlineMs: null } }],
    });
  }

  function fireTimer(dev: string, gen: number) {
    if (!live(dev, gen)()) return; // stale generation: ignored, emits nothing
    const tm = ep(dev).timers.rto;
    if (!tm) return;
    if (tm.retries >= cfg.maxRetries) {
      emit({
        device: dev, direction: 'local', layer: 'transport', type: 'give-up', tag: 'timer:giveup', explainKey: 'give-up', packetId: lastSent.get(dev)?.pid ?? null,
        explainArgs: { max: cfg.maxRetries, device: dev },
        transition: { machine: 'app', from: ep(dev).app, to: 'failed' },
        effects: [
          { k: 'timer', device: dev, name: 'rto', timer: { ...tm, armed: false, deadlineMs: null } },
          { k: 'endpoint', device: dev, patch: { app: 'failed' } },
        ],
      });
      return;
    }
    const fired = emit({
      device: dev, direction: 'local', layer: 'transport', type: 'timer-fire', tag: 'timer:fire:rto', packetId: lastSent.get(dev)?.pid ?? null,
      explainKey: 'timer.fire', explainArgs: { attempt: tm.retries + 1, max: cfg.maxRetries },
      transition: { machine: 'timer', from: 'armed', to: 'expired' },
      effects: [{ k: 'timer', device: dev, name: 'rto', timer: { ...tm, armed: false, deadlineMs: null } }],
    });
    const last = lastSent.get(dev);
    if (!fired || !last) return;
    const orig = pkt(last.pid);
    const rid = `${last.pid}#r${tm.retries + 1}`;
    const frame = Uint8Array.from(orig.original);
    const id = emit({
      device: dev, direction: 'local', layer: 'transport', type: 'retransmit', tag: 'tcp:retransmit', packetId: rid, causeId: fired,
      bytes: [...frame], explainKey: 'retransmit', explainArgs: { frameBytes: frame.length, kind: orig.kind },
      effects: [
        {
          k: 'packet', id: rid,
          rec: { ...orig, id: rid, current: [...orig.original], at: dev, status: 'host', attempt: tm.retries + 1, rx: { transport: 'pending', app: 'pending' } },
        },
        { k: 'metric', add: { retransmissions: 1 } },
      ],
    });
    armTimer(dev, tm.retries + 1, id, rid);
    schedule(now + (t.devices[dev]?.processingNs ?? 0), () => transmit(rid, frame, dev, last.outIface, id));
  }

  // ---------- run ----------
  schedule(0, () => {
    if (!isTcp) {
      const id = emit({
        device: t.client, direction: 'local', layer: 'transport', type: 'session', tag: 'session:start',
        explainKey: 'session.udp', explainArgs: { flow: flowId },
      });
      appWrite(t.client, request, false, id);
      return;
    }
    // Server passive open, client app writes (queued), client active open with SYN.
    const listen = tcpState(t.server, 'LISTEN', {}, null, 'tcp.listen', { port: sPort });
    if (request.length > 0) appWrite(t.client, request, false, listen); // empty: orderly no-data close
    const iss = cfg.tcp.isnClient;
    const c = emit({
      device: t.client, direction: 'local', layer: 'transport', type: 'session', tag: 'tcp:connect',
      explainKey: 'tcp.connect', explainArgs: { device: t.client, iss, flow: flowId },
      effects: [{ k: 'endpoint', device: t.client, patch: { iss, sndUna: iss, sndNxt: iss } }],
    });
    const syn = sendSegment({ kind: 'syn', from: t.client, payload: new Uint8Array(), flags: { ...NO_FLAGS, syn: true }, consumes: 1, causeId: c });
    tcpState(t.client, 'SYN-SENT', {}, syn, 'tcp.syn-sent', { seq: iss });
  });

  for (;;) {
    if (ended) break;
    const a = q.pop();
    if (!a) break;
    if (a.live && !a.live()) continue; // cancelled timer: never advances time or ends the run
    if (a.timeNs < now) throw new Error('virtual time went backwards');
    if (a.timeNs > maxNs) {
      now = maxNs;
      finish('max-duration');
      break;
    }
    now = a.timeNs;
    curSeq = a.seq;
    a.run();
  }
  if (!ended) {
    now = lastEventNs;
    finish('complete');
  }

  const frozen = deepFreeze(events);
  return { config: cfg, template: t, events: frozen, timeline: new SnapshotTimeline(init, frozen) };
}
