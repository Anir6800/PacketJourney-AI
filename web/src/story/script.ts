import { bin, hex, simulate, type Field, type SimRun, type SimulationEvent } from '@packetjourney/shared';

// Story Mode script. Every caption is a template (mirrored in docs/STORY_SCRIPT.md) filled only from engine
// output: events, their arguments and the reducer's field map. Templates contain no hand-written numbers.

export const T = {
  'encap.app.title': 'Application · your message',
  'encap.app.1': 'Your message "{text}" is {bytes} bytes of UTF-8.',
  'encap.app.2': 'Its first byte is 0x{hex0}, which travels as the bits {bin0}.',
  'encap.transport.tcp.title': 'Transport · TCP segment',
  'encap.transport.tcp.1': 'TCP adds a {hdr}-byte header: port {src} → {dst}, seq {seq}, ack {ack}.',
  'encap.transport.tcp.2': 'Checksum {cs} covers a pseudo-header with both IP addresses, this header and your {bytes} bytes.',
  'encap.transport.udp.title': 'Transport · UDP datagram',
  'encap.transport.udp.1': 'UDP adds an {hdr}-byte header: port {src} → {dst}, length {len} bytes.',
  'encap.transport.udp.2': 'Checksum {cs} covers a pseudo-header, this header and the data.',
  'encap.internet.title': 'Internet · IPv4 packet',
  'encap.internet.1': 'IPv4 adds {hdr} bytes: {srcIp} → {dstIp}, TTL {ttl}, protocol {proto}.',
  'encap.internet.2': 'Header checksum {cs} protects only the IPv4 header; the packet is {total} bytes.',
  'encap.link.title': 'Link · Ethernet II frame',
  'encap.link.1': 'Ethernet addresses the next hop: {srcMac} → {dstMac}, EtherType 0x{etherType}.',
  'encap.link.2': '{pad} padding bytes and FCS 0x{fcs} complete a {frame}-byte frame.',
  'encap.physical.title': 'Physical · bits on the wire (SIMULATED teaching view)',
  'encap.physical.1': '{dev} sends {bits} bits ({onLink} byte-times with preamble and gap) at {mbps} Mb/s.',
  'encap.physical.2': 'Serialization takes {ser} ms and propagation {prop} ms on {link}.',
  'journey.state.title': '{device} · {to}',
  'journey.state.1': '{device} moves from {from} to {to}.',
  'journey.send.tcp.title': '{device} sends {label}',
  'journey.send.tcp.1': 'Flags {flags}, seq {seq}, ack {ack}, {bytes} data bytes.',
  'journey.send.udp.title': '{device} sends a datagram',
  'journey.send.udp.1': 'A {frame}-byte frame carrying {bytes} data bytes to port {dstPort}.',
  'journey.forward.title': '{device} forwards the packet',
  'journey.forward.1': 'TTL {ttlFrom} → {ttlTo}; header checksum {csFrom} → {csTo}.',
  'journey.forward.2': 'A new frame for the next hop: {srcMac} → {dstMac}. IPs and ports stay the same.',
  'journey.ack.title': '{device} receives ACK {ack}',
  'journey.ack.1': 'That acknowledges {what}.',
  'journey.deliver.title': '{device} delivers {bytes} bytes',
  'journey.deliver.1': '{app} receives "{text}".',
  'journey.drop.title': '{device} drops the packet',
  'journey.drop.1': '{why}',
  'journey.retx.title': '{device} retransmits',
  'journey.retx.1': 'Its timer expired; the original {frame}-byte {kind} frame is sent again.',
  'decap.link.title': '{device} · Link layer',
  'decap.link.1': 'Destination MAC {dstMac} is this interface and the FCS checks out.',
  'decap.link.2': 'Ethernet header, {pad} padding bytes and FCS are removed, leaving {bytes} bytes.',
  'decap.internet.title': '{device} · Internet layer',
  'decap.internet.1': 'IPv4 checksum {cs} is valid, destination {dst} is this host, TTL {ttl}.',
  'decap.internet.2': 'The IPv4 header is removed, leaving a {bytes}-byte {unit}.',
  'decap.transport.title': '{device} · Transport layer',
  'decap.transport.tcp.1': 'TCP checksum {cs} verifies; seq {seq} is the next byte expected.',
  'decap.transport.udp.1': 'UDP checksum {cs} verifies; length {length} matches.',
  'decap.transport.2': 'Port {port} belongs to {app}.',
  'decap.app.title': '{device} · Application',
  'decap.app.1': '{app} reads {bytes} bytes: "{text}", unchanged end to end.',
  'decap.missing.title': 'The data never reached {device}',
  'decap.missing.1': 'No delivery event exists for this packet in the run.',
  'recap.process.title': 'Recap · process to process',
  'recap.process.1': 'Ports pick the applications: {cIp}:{cPort} ⇄ {sIp}:{sPort} over {proto}.',
  'recap.host.title': 'Recap · host to host',
  'recap.host.1': 'IPv4 carries {cIp} → {sIp} unchanged across {hops} link(s); routers never rewrite them.',
  'recap.hop.title': 'Recap · hop to hop',
  'recap.hop.1': 'Each link has its own MAC pair: {macs}.',
  'recap.changes.title': 'Recap · what changed, what stayed',
  'recap.changes.1': 'Per hop the TTL went {ttls}, and MACs, IP checksum and FCS were rebuilt.',
  'recap.changes.2': 'IPs, ports and the transport checksum {tcs} stayed constant on every hop.',
  'recap.predict.title': 'Recap · predict',
  'recap.predict.1': 'Two quick predictions, answered by re-running the engine.',
  'predict.ttl.q': 'With an initial TTL of {ttl}, where would your request stop?',
  'predict.ttl.a.drop': 'At {device}: TTL would expire there, so it drops the packet (ICMP NOT BUILT).',
  'predict.ttl.a.ok': 'It still arrives at {device}: no router decrements TTL on a single link.',
  'predict.ack.q': 'If your message were one byte longer, which ACK would the server send?',
  'predict.ack.a': 'ACK {ack}: it acknowledges every byte, so it grows by one.',
  'predict.udpack.q': 'How many ACK segments did UDP send in this run?',
  'predict.udpack.a': '{n}: UDP has no acknowledgements; loss is not repaired.',
} as const;

export type TemplateKey = keyof typeof T;
export type Values = Record<string, string | number>;

export function fill(key: TemplateKey, v: Values): string {
  return T[key].replace(/\{(\w+)\}/g, (_, k: string) => {
    const x = v[k];
    if (x === undefined) throw new Error(`story template ${key}: missing {${k}}`);
    return String(x);
  });
}

export type Chapter = 'encap' | 'journey' | 'decap' | 'recap';
export const CHAPTERS: { id: Chapter; label: string }[] = [
  { id: 'encap', label: 'Encapsulation' },
  { id: 'journey', label: 'Journey' },
  { id: 'decap', label: 'Decapsulation' },
  { id: 'recap', label: 'Recap' },
];
export type StoryLayer = 'app' | 'transport' | 'internet' | 'link' | 'physical';
export type Beat = {
  id: string;
  chapter: Chapter;
  kind: string;
  /** Event the clock seeks to (end of its cue). */
  event: number;
  rig: 'overview' | 'follow' | 'inspect';
  layer: StoryLayer | null;
  /** Field ids highlighted in the 2D inspector. */
  fields: string[];
  scope: 'process' | 'host' | 'hop' | null;
  /** Template keys and the values they were filled from (kept for tests and the docs). */
  keys: TemplateKey[];
  values: Values;
  title: string;
  lines: string[];
  predict?: { q: string; a: string }[];
};

const hex4 = (n: number | null | undefined) => `0x${hex(n ?? 0, 4)}`;
const showText = (bytes: readonly number[]) => new TextDecoder().decode(Uint8Array.from(bytes)).replace(/\r\n/g, '␍␊');
const ACK_KINDS = new Set(['ack', 'hs-ack', 'response-ack', 'ack-fin-client', 'ack-fin-server']);
const LABEL: Record<string, string> = {
  syn: 'SYN', 'syn-ack': 'SYN-ACK', 'hs-ack': 'the handshake ACK', data: 'the request', ack: 'an ACK', response: 'the reply', 'response-ack': 'an ACK',
  'fin-client': 'FIN', 'ack-fin-client': 'an ACK of FIN', 'fin-server': 'FIN', 'ack-fin-server': 'the final ACK',
};

function make(chapter: Chapter, kind: string, e: SimulationEvent, opts: Partial<Beat>, title: TemplateKey, lines: TemplateKey[], v: Values): Beat {
  return {
    id: `${chapter}:${kind}:${e.index}`,
    chapter, kind, event: e.index, rig: 'follow', layer: null, fields: [], scope: null,
    ...opts,
    keys: [title, ...lines], values: v, title: fill(title, v), lines: lines.map((k) => fill(k, v)),
  };
}

/** Builds the whole story for a run. Pure: same run → same beats. */
export function buildStory(run: SimRun): Beat[] {
  const ev = run.events;
  const fin = run.timeline.final;
  const tcp = run.config.protocol === 'TCP';
  const { client, server } = run.template;
  const kindOf = (pid: string | null) => (pid ? fin.packets[pid]?.kind : undefined);
  const dataPid = ev.find((e) => e.tag === 'encap:transport' && kindOf(e.packetId) === 'data')?.packetId ?? null;
  const find = (pred: (e: SimulationEvent) => boolean) => ev.find(pred);
  const f = (id: string): Field | undefined => fin.fields.find((x) => x.id === id);
  const raw = (id: string) => f(id)?.raw ?? 0;
  const disp = (id: string) => f(id)?.display ?? '';
  const units = fin.units;
  const beats: Beat[] = [];
  const l4 = tcp ? 'tcp' : 'udp';

  // ---------- Encapsulation: one layer per beat, innermost first ----------
  const send = find((e) => e.tag === 'app:send');
  const encT = find((e) => e.tag === 'encap:transport' && e.packetId === dataPid);
  const encI = find((e) => e.tag === 'encap:internet' && e.packetId === dataPid);
  const encL = find((e) => e.tag === 'encap:link' && e.packetId === dataPid && e.device === client);
  const tx = find((e) => e.type === 'transmit' && e.packetId === dataPid && e.device === client);
  const app = units.app ?? [];
  if (send && app.length) {
    beats.push(make('encap', 'layer', send, { rig: 'inspect', layer: 'app', fields: ['payload.data'] }, 'encap.app.title', ['encap.app.1', 'encap.app.2'], {
      text: showText(app), bytes: app.length, hex0: hex(app[0] ?? 0), bin0: bin(app[0] ?? 0),
    }));
  }
  if (encT) {
    const hdr = (units.transport?.length ?? 0) - app.length;
    const common = { src: raw(`${l4}.srcPort`), dst: raw(`${l4}.dstPort`), cs: hex4(raw(`${l4}.checksum`)), hdr, bytes: app.length };
    beats.push(
      tcp
        ? make('encap', 'layer', encT, { rig: 'inspect', layer: 'transport', fields: ['tcp.srcPort', 'tcp.dstPort', 'tcp.seqNumber', 'tcp.ackNumber', 'tcp.checksum'] },
            'encap.transport.tcp.title', ['encap.transport.tcp.1', 'encap.transport.tcp.2'], { ...common, seq: raw('tcp.seqNumber'), ack: raw('tcp.ackNumber') })
        : make('encap', 'layer', encT, { rig: 'inspect', layer: 'transport', fields: ['udp.srcPort', 'udp.dstPort', 'udp.length', 'udp.checksum'] },
            'encap.transport.udp.title', ['encap.transport.udp.1', 'encap.transport.udp.2'], { ...common, len: raw('udp.length') }),
    );
  }
  if (encI) {
    beats.push(make('encap', 'layer', encI, { rig: 'inspect', layer: 'internet', fields: ['ipv4.src', 'ipv4.dst', 'ipv4.ttl', 'ipv4.protocol', 'ipv4.checksum'] },
      'encap.internet.title', ['encap.internet.1', 'encap.internet.2'], {
        hdr: (units.internet?.length ?? 0) - (units.transport?.length ?? 0), srcIp: disp('ipv4.src'), dstIp: disp('ipv4.dst'),
        ttl: raw('ipv4.ttl'), proto: `${raw('ipv4.protocol')} (${tcp ? 'TCP' : 'UDP'})`, cs: hex4(raw('ipv4.checksum')), total: raw('ipv4.totalLength'),
      }));
  }
  if (encL) {
    beats.push(make('encap', 'layer', encL, { rig: 'inspect', layer: 'link', fields: ['ethernet.src', 'ethernet.dst', 'ethernet.etherType', 'padding.bytes', 'fcs.crc32'] },
      'encap.link.title', ['encap.link.1', 'encap.link.2'], {
        srcMac: disp('ethernet.src'), dstMac: disp('ethernet.dst'), etherType: hex(raw('ethernet.etherType'), 4),
        pad: raw('padding.bytes'), fcs: hex(raw('fcs.crc32'), 8), frame: units.link?.length ?? 0,
      }));
  }
  if (tx?.timing) {
    const t = tx.timing;
    beats.push(make('encap', 'layer', tx, { rig: 'follow', layer: 'physical' }, 'encap.physical.title', ['encap.physical.1', 'encap.physical.2'], {
      dev: tx.device, bits: t.bits, onLink: t.onLinkBytes, mbps: t.bps / 1e6, ser: tx.explainArgs.serMs ?? '', prop: tx.explainArgs.propMs ?? '', link: tx.explainArgs.link ?? '',
    }));
  }

  // ---------- Journey: handshake (TCP), each packet's send, router hops of the data packet, ACKs, delivery ----------
  const sent = new Set<string>();
  for (const e of ev) {
    const pid = e.packetId;
    const kind = kindOf(pid) ?? '';
    if (e.type === 'tcp-state' && e.transition && e.transition.to !== 'LISTEN') {
      const { from, to } = e.transition;
      beats.push(make('journey', 'state', e, {}, 'journey.state.title', ['journey.state.1'], { device: e.device, from, to }));
    } else if (e.type === 'transmit' && pid && !sent.has(pid) && (e.device === client || e.device === server)) {
      sent.add(pid);
      const enc = find((x) => x.tag === 'encap:transport' && x.packetId === pid);
      const a = enc?.explainArgs ?? {};
      beats.push(
        tcp
          ? make('journey', ACK_KINDS.has(kind) ? 'ack-send' : 'send', e, {}, 'journey.send.tcp.title', ['journey.send.tcp.1'], {
              device: e.device, label: LABEL[kind] ?? kind, flags: a.flags ?? '', seq: a.seq ?? '', ack: a.ack ?? '', bytes: (enc?.bytes?.length ?? 0) - ((((enc?.bytes ?? [])[12] ?? 0x50) >> 4) * 4),
            })
          : make('journey', 'send', e, {}, 'journey.send.udp.title', ['journey.send.udp.1'], {
              device: e.device, frame: e.timing?.frameBytes ?? 0, bytes: (enc?.bytes?.length ?? 8) - 8, dstPort: kind === 'data' ? run.config.requestDstPort : run.config.endpoints.client.port,
            }),
      );
    } else if (/^hop:.+:forward$/.test(e.tag) && pid === dataPid) {
      const re = ev.find((x) => x.index > e.index && x.tag === 'encap:link' && x.device === e.device && x.packetId === pid);
      const a = e.explainArgs;
      beats.push(make('journey', 'hop', e, {}, 'journey.forward.title', ['journey.forward.1', 'journey.forward.2'], {
        device: e.device, ttlFrom: a.ttlFrom ?? '', ttlTo: a.ttlTo ?? '', csFrom: a.csFrom ?? '', csTo: a.csTo ?? '',
        srcMac: re?.explainArgs['Source MAC'] ?? '', dstMac: re?.explainArgs.dstMac ?? '',
      }));
    } else if (e.tag === 'ack' && tcp) {
      beats.push(make('journey', 'ack', e, {}, 'journey.ack.title', ['journey.ack.1'], { device: e.device, ack: e.explainArgs.ack ?? '', what: e.explainArgs.what ?? '' }));
    } else if (e.tag === 'deliver:app') {
      beats.push(make('journey', 'deliver', e, {}, 'journey.deliver.title', ['journey.deliver.1'], {
        device: e.device, bytes: e.explainArgs.bytes ?? 0, app: e.explainArgs.app ?? '', text: showText(e.bytes ?? []),
      }));
    } else if (e.type === 'drop' || e.tag === 'socket:none') {
      beats.push(make('journey', 'drop', e, {}, 'journey.drop.title', ['journey.drop.1'], {
        device: e.device, why: String(e.explainArgs.reason ?? (e.tag === 'drop' ? `lost on ${e.explainArgs.link} (SIMULATED fault)` : e.tag === 'drop:ttl' ? 'TTL expired' : 'no application on that port')),
      }));
    } else if (e.tag === 'tcp:retransmit') {
      beats.push(make('journey', 'retx', e, {}, 'journey.retx.title', ['journey.retx.1'], { device: e.device, frame: e.explainArgs.frameBytes ?? 0, kind: LABEL[String(e.explainArgs.kind)] ?? String(e.explainArgs.kind) }));
    }
  }

  // ---------- Decapsulation at the receiver, outermost first (data packet's delivered copy) ----------
  const at = (tag: string) => [...ev].reverse().find((e) => e.tag === tag && e.device === server && (e.packetId === dataPid || e.packetId?.startsWith(`${dataPid}#`)));
  const vL = at('verify:link');
  const dL = at('decap:link');
  const vI = at('verify:internet');
  const dI = at('decap:internet');
  const vT = at('verify:transport');
  const sock = at('socket:select');
  const del = at('deliver:app');
  if (vL && dL) {
    beats.push(make('decap', 'layer', dL, { rig: 'inspect', layer: 'link', fields: ['ethernet.dst', 'fcs.crc32'] }, 'decap.link.title', ['decap.link.1', 'decap.link.2'], {
      device: server, dstMac: vL.explainArgs.dstMac ?? '', pad: dL.explainArgs.padding ?? 0, bytes: dL.explainArgs.bytes ?? 0,
    }));
  }
  if (vI && dI) {
    beats.push(make('decap', 'layer', dI, { rig: 'inspect', layer: 'internet', fields: ['ipv4.checksum', 'ipv4.dst', 'ipv4.ttl'] }, 'decap.internet.title', ['decap.internet.1', 'decap.internet.2'], {
      device: server, cs: vI.explainArgs.checksum ?? '', dst: vI.explainArgs.dst ?? '', ttl: vI.explainArgs.ttl ?? '', bytes: dI.explainArgs.bytes ?? 0, unit: dI.explainArgs.unit ?? '',
    }));
  }
  if (vT && sock) {
    const tv: Values = { device: server, cs: vT.explainArgs.checksum ?? '', port: sock.explainArgs.port ?? '', app: sock.explainArgs.app ?? '' };
    beats.push(
      tcp
        ? make('decap', 'layer', sock, { rig: 'inspect', layer: 'transport', fields: ['tcp.checksum', 'tcp.dstPort', 'tcp.seqNumber'] }, 'decap.transport.title', ['decap.transport.tcp.1', 'decap.transport.2'], { ...tv, seq: vT.explainArgs.seq ?? '' })
        : make('decap', 'layer', sock, { rig: 'inspect', layer: 'transport', fields: ['udp.checksum', 'udp.dstPort', 'udp.length'] }, 'decap.transport.title', ['decap.transport.udp.1', 'decap.transport.2'], { ...tv, length: vT.explainArgs.length ?? '' }),
    );
  }
  if (del) {
    beats.push(make('decap', 'layer', del, { rig: 'inspect', layer: 'app', fields: ['payload.data'] }, 'decap.app.title', ['decap.app.1'], {
      device: server, app: del.explainArgs.app ?? '', bytes: del.explainArgs.bytes ?? 0, text: showText(del.bytes ?? []),
    }));
  } else {
    const last = ev[ev.length - 1];
    if (last) beats.push(make('decap', 'missing', last, { rig: 'overview' }, 'decap.missing.title', ['decap.missing.1'], { device: server }));
  }

  // ---------- Recap ----------
  const last = ev[ev.length - 1];
  if (last) {
    const t = run.template;
    const cIp = t.devices[client]?.ifaces[0]?.ip ?? '';
    const sIp = t.devices[server]?.ifaces[0]?.ip ?? '';
    const hops = ev.filter((e) => e.type === 'transmit' && e.packetId === dataPid);
    const anchor = del ?? last;
    beats.push(make('recap', 'scope', anchor, { rig: 'overview', scope: 'process' }, 'recap.process.title', ['recap.process.1'], {
      cIp, sIp, cPort: run.config.endpoints.client.port, sPort: run.config.requestDstPort, proto: run.config.protocol,
    }));
    beats.push(make('recap', 'scope', anchor, { rig: 'overview', scope: 'host' }, 'recap.host.title', ['recap.host.1'], { cIp, sIp, hops: hops.length }));
    const macs = hops.map((h) => {
      const b = h.bytes ?? [];
      const m = (o: number) => b.slice(o, o + 6).map((x) => x.toString(16).padStart(2, '0')).join(':');
      return `${h.timing ? h.explainArgs.link : ''} ${m(6)} → ${m(0)}`;
    });
    beats.push(make('recap', 'scope', anchor, { rig: 'overview', scope: 'hop' }, 'recap.hop.title', ['recap.hop.1'], { macs: macs.join('; ') }));
    const ttls = hops.map((h) => h.bytes?.[22] ?? 0);
    const tcsAt = tcp ? 50 : 40; // frame offset of the transport checksum (14 Ethernet + 20 IPv4 + 16 TCP / 6 UDP)
    const tcsFirst = hops[0]?.bytes;
    beats.push(make('recap', 'changes', anchor, { rig: 'overview', scope: 'hop' }, 'recap.changes.title', ['recap.changes.1', 'recap.changes.2'], {
      ttls: ttls.join(' → '), tcs: tcsFirst ? hex4(((tcsFirst[tcsAt] ?? 0) << 8) | (tcsFirst[tcsAt + 1] ?? 0)) : '',
    }));
    beats.push({ ...make('recap', 'predict', anchor, { rig: 'overview' }, 'recap.predict.title', ['recap.predict.1'], {}), predict: predictions(run) });
  }
  return beats;
}

/** Prediction answers come from re-running the engine with one input changed. */
export function predictions(run: SimRun): { q: string; a: string }[] {
  const cfg = run.config;
  const out: { q: string; a: string }[] = [];
  // The hypothetical input is a parameter of the re-run, and the question shows that same value.
  const TTL_PROBE = 1;
  const ttl1 = simulate({ ...structuredClone(cfg), ttl: TTL_PROBE, faults: [] });
  const drop = ttl1.events.find((e) => e.tag === 'drop:ttl');
  out.push({
    q: fill('predict.ttl.q', { ttl: TTL_PROBE }),
    a: drop ? fill('predict.ttl.a.drop', { device: drop.device }) : fill('predict.ttl.a.ok', { device: ttl1.template.server }),
  });
  if (cfg.protocol === 'TCP') {
    const longer = simulate({ ...structuredClone(cfg), request: cfg.payloadMode === 'raw' ? `${cfg.request}!` : cfg.request, http: { ...cfg.http, path: `${cfg.http.path}x` }, faults: [] });
    const ackEnc = longer.events.find((e) => e.tag === 'encap:transport' && longer.timeline.final.packets[e.packetId ?? '']?.kind === 'ack');
    out.push({ q: T['predict.ack.q'], a: fill('predict.ack.a', { ack: ackEnc?.explainArgs.ack ?? '' }) });
  } else {
    const n = run.events.filter((e) => e.tag === 'ack' || e.tag === 'ack:duplicate').length;
    out.push({ q: T['predict.udpack.q'], a: fill('predict.udpack.a', { n }) });
  }
  return out;
}

/** Reading-time estimate at 1×: typing at 45 chars/s plus a 3.5 s auto-play hold per beat. */
export const STORY_CPS = 45;
export const AUTO_HOLD_MS = 3500;
export const estimateSeconds = (beats: readonly Beat[]) =>
  beats.reduce((n, b) => n + [b.title, ...b.lines].join('').length / STORY_CPS + AUTO_HOLD_MS / 1000, 0);
