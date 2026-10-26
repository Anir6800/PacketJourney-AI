import { defaultSimConfig, simulate, simulateHttpSession, type SimRun, type SimulationEvent } from '@packetjourney/shared';

// Practice: authored prediction questions. Prompts and answers are filled from engine runs of fixed fixtures,
// never typed in by hand; grading is deterministic string/number comparison (no AI).

export type Evidence = { label: string; value: string };
export type Question = {
  id: string;
  prompt: string;
  kind: 'number' | 'text' | 'yesno';
  answer: string;
  explanation: string;
  evidence: Evidence[];
  /** Event that proves the answer (index into the fixture run), for reference. */
  eventTag: string;
};

const mac = (b: readonly number[], o: number) => b.slice(o, o + 6).map((x) => x.toString(16).padStart(2, '0')).join(':');
const ip = (b: readonly number[], o: number) => b.slice(o, o + 4).join('.');
const u16 = (b: readonly number[], o: number) => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const kind = (r: SimRun, e: SimulationEvent) => r.timeline.final.packets[e.packetId ?? '']?.kind;
const first = (r: SimRun, p: (e: SimulationEvent) => boolean) => {
  const e = r.events.find(p);
  if (!e) throw new Error('practice fixture is missing an expected event');
  return e;
};

export function buildQuestions(): Question[] {
  const routed = simulate(defaultSimConfig('routed', 'TCP'));
  const udp = simulate(defaultSimConfig('routed', 'UDP'));
  const udpLoss = simulate({ ...defaultSimConfig('routed', 'UDP'), faults: [{ kind: 'drop', target: { packet: 'data', attempt: 0, hop: 0 } }] });
  const tcpLoss = simulate({ ...defaultSimConfig('routed', 'TCP'), faults: [{ kind: 'drop', target: { packet: 'data', attempt: 0, hop: 0 } }] });
  const closing = simulate({ ...defaultSimConfig('routed', 'TCP'), close: { enabled: true, timeWaitMs: 400 } });
  const session = simulateHttpSession(defaultSimConfig('same-lan', 'TCP'), 'valid');

  const aOut = first(routed, (e) => e.type === 'transmit' && e.device === 'A' && kind(routed, e) === 'data').bytes ?? [];
  const r1Out = first(routed, (e) => e.type === 'transmit' && e.device === 'R1' && kind(routed, e) === 'data').bytes ?? [];
  const r2Out = first(routed, (e) => e.type === 'transmit' && e.device === 'R2' && kind(routed, e) === 'data').bytes ?? [];
  const dataEnc = first(routed, (e) => e.tag === 'encap:transport' && kind(routed, e) === 'data');
  const ackEnc = first(routed, (e) => e.tag === 'encap:transport' && kind(routed, e) === 'ack');
  const synEnc = first(routed, (e) => e.tag === 'encap:transport' && kind(routed, e) === 'syn');
  const synAckEnc = first(routed, (e) => e.tag === 'encap:transport' && kind(routed, e) === 'syn-ack');
  const firstDataTx = first(routed, (e) => e.type === 'transmit' && e.device === 'A' && kind(routed, e) === 'data').index;
  const beforeData = routed.events.filter((e) => e.index < firstDataTx && e.type === 'transmit' && (e.device === 'A' || e.device === 'B')).length;
  const udpFirstData = first(udp, (e) => e.type === 'transmit' && e.device === 'A' && kind(udp, e) === 'data').index;
  const udpBefore = udp.events.filter((e) => e.index < udpFirstData && e.type === 'transmit').length;
  const finState = first(closing, (e) => e.device === 'A' && e.type === 'tcp-state' && e.transition?.from === 'ESTABLISHED');
  const serverSession = session.b.timeline.final.endpoints[session.b.template.server]?.session;

  return [
    {
      id: 'mac-r1', kind: 'text', eventTag: 'hop:R1:egress',
      prompt: `A sends the request to its gateway with destination MAC ${mac(aOut, 0)}. After R1 forwards it onto the next link, what is the frame's destination MAC?`,
      answer: mac(r1Out, 0),
      explanation: 'Each router builds a new Ethernet frame addressed to the next hop on its outgoing link.',
      evidence: [{ label: 'A → R1 dst MAC', value: mac(aOut, 0) }, { label: 'R1 → R2 src MAC', value: mac(r1Out, 6) }, { label: 'R1 → R2 dst MAC', value: mac(r1Out, 0) }],
    },
    {
      id: 'ttl-r2', kind: 'number', eventTag: 'hop:R2:egress',
      prompt: `The request leaves A with TTL ${aOut[22]}. What TTL does it carry when R2 transmits it?`,
      answer: String(r2Out[22]),
      explanation: 'Every router decrements TTL by one before forwarding; the sender and the receiver do not.',
      evidence: [{ label: 'TTL leaving A', value: String(aOut[22]) }, { label: 'TTL leaving R1', value: String(r1Out[22]) }, { label: 'TTL leaving R2', value: String(r2Out[22]) }],
    },
    {
      id: 'ip-same', kind: 'yesno', eventTag: 'hop:R1:egress',
      prompt: 'Does R1 change the destination IPv4 address of the request?',
      answer: ip(aOut, 30) === ip(r1Out, 30) ? 'no' : 'yes',
      explanation: 'Without NAT, routers never rewrite endpoint IP addresses; only TTL and the header checksum change.',
      evidence: [{ label: 'dst IP leaving A', value: ip(aOut, 30) }, { label: 'dst IP leaving R1', value: ip(r1Out, 30) }],
    },
    {
      id: 'port-b', kind: 'number', eventTag: 'socket:select',
      prompt: `The client app uses source port ${u16(aOut, 34)}. Which destination port arrives at B, unchanged by the routers?`,
      answer: String(u16(r2Out, 36)),
      explanation: 'Ports live in the transport header, which routers forward byte for byte.',
      evidence: [{ label: 'dst port leaving A', value: String(u16(aOut, 36)) }, { label: 'dst port leaving R2', value: String(u16(r2Out, 36)) }],
    },
    {
      id: 'ack-arith', kind: 'number', eventTag: 'encap:transport',
      prompt: `The request has seq ${dataEnc.explainArgs.seq} and carries ${dataEnc.explainArgs.consumes} bytes. Which ACK number does the server send back?`,
      answer: String(ackEnc.explainArgs.ack),
      explanation: 'The ACK names the next byte expected: seq + number of data bytes.',
      evidence: [{ label: 'request seq', value: String(dataEnc.explainArgs.seq) }, { label: 'data bytes', value: String(dataEnc.explainArgs.consumes) }, { label: 'server ACK', value: String(ackEnc.explainArgs.ack) }],
    },
    {
      id: 'syn-ack', kind: 'number', eventTag: 'encap:transport',
      prompt: `The client's SYN has seq ${synEnc.explainArgs.seq}. Which ACK number does the SYN-ACK carry?`,
      answer: String(synAckEnc.explainArgs.ack),
      explanation: 'A SYN consumes one sequence number even though it carries no data.',
      evidence: [{ label: 'SYN seq', value: String(synEnc.explainArgs.seq) }, { label: 'SYN-ACK ack', value: String(synAckEnc.explainArgs.ack) }],
    },
    {
      id: 'tcp-before', kind: 'number', eventTag: 'tcp:state:ESTABLISHED',
      prompt: 'How many TCP segments do the two endpoints send before the first data byte leaves the client?',
      answer: String(beforeData),
      explanation: 'The three-way handshake (SYN, SYN-ACK, ACK) comes before any data.',
      evidence: routed.events.filter((e) => e.index < firstDataTx && e.type === 'transmit' && (e.device === 'A' || e.device === 'B')).map((e) => ({ label: `${e.device} sends`, value: kind(routed, e) ?? '' })),
    },
    {
      id: 'udp-before', kind: 'number', eventTag: 'app:send',
      prompt: 'Same path with UDP: how many frames are sent before the first datagram?',
      answer: String(udpBefore),
      explanation: 'UDP has no connection setup: the first frame on the wire is the datagram itself.',
      evidence: [{ label: 'transmissions before the datagram', value: String(udpBefore) }],
    },
    {
      id: 'udp-retry', kind: 'number', eventTag: 'drop:fault',
      prompt: 'UDP, and the first datagram is dropped on the first link. How many times is it retransmitted?',
      answer: String(udpLoss.events.filter((e) => e.tag === 'tcp:retransmit').length),
      explanation: 'UDP has no ACKs and no retransmission timer; recovery would be the application’s job.',
      evidence: [{ label: 'drops', value: String(udpLoss.events.filter((e) => e.type === 'drop').length) }, { label: 'deliveries at B', value: String(udpLoss.events.filter((e) => e.tag === 'deliver:app' && e.device === 'B').length) }],
    },
    {
      id: 'tcp-once', kind: 'number', eventTag: 'deliver:app',
      prompt: 'TCP, and the first data segment is dropped on the first link. How many times does B’s app receive the message?',
      answer: String(tcpLoss.events.filter((e) => e.tag === 'deliver:app' && e.device === 'B').length),
      explanation: 'The retransmission fills the gap; TCP delivers each byte range to the application once.',
      evidence: [{ label: 'retransmissions', value: String(tcpLoss.events.filter((e) => e.tag === 'tcp:retransmit').length) }, { label: 'deliveries at B', value: String(tcpLoss.events.filter((e) => e.tag === 'deliver:app' && e.device === 'B').length) }],
    },
    {
      id: 'fin-state', kind: 'text', eventTag: 'tcp:state:FIN-WAIT-1',
      prompt: 'The client sends its FIN to start closing. Which TCP state does it enter?',
      answer: finState.transition?.to ?? '',
      explanation: 'The active closer waits for the ACK of its FIN in this state.',
      evidence: [{ label: 'transition', value: `${finState.transition?.from} → ${finState.transition?.to}` }],
    },
    {
      id: 'session', kind: 'yesno', eventTag: 'app:processed',
      prompt: `Connection A closed. Connection B uses a new client port (${session.b.config.endpoints.client.port}) and sends the demo cookie. Does the server app recognize the session?`,
      answer: serverSession?.verdict === 'recognized' ? 'yes' : 'no',
      explanation: 'The session lives in the application (cookie + server memory), separate from any one TCP connection.',
      evidence: [{ label: 'cookie sent', value: serverSession?.cookieSent ?? 'none' }, { label: 'server verdict', value: serverSession?.verdict ?? '' }],
    },
  ];
}

/** Deterministic grading: trimmed, case-insensitive; numbers compare numerically; MAC separators normalized; y/n accepted. */
export function grade(q: Question, input: string): boolean {
  const a = input.trim().toLowerCase();
  if (!a) return false;
  if (q.kind === 'number') return /^-?\d+$/.test(a) && Number(a) === Number(q.answer);
  if (q.kind === 'yesno') return (a === 'y' ? 'yes' : a === 'n' ? 'no' : a) === q.answer;
  const norm = (s: string) => s.toLowerCase().replace(/[-.]/g, ':').replace(/\s+/g, ' ');
  return norm(a) === norm(q.answer);
}

const KEY = 'pj.practice';
export type Progress = Record<string, { input: string; correct: boolean }>;
export function loadProgress(): Progress {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid progress');
    const entries = Object.entries(value);
    if (!entries.every(([, v]) => typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { input?: unknown }).input === 'string' && typeof (v as { correct?: unknown }).correct === 'boolean'))
      throw new Error('invalid progress');
    return Object.fromEntries(entries) as Progress;
  } catch {
    try { localStorage.removeItem(KEY); } catch { /* unavailable */ }
    return {};
  }
}
export function saveProgress(p: Progress) {
  try {
    if (Object.keys(p).length) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch {
    // optional convenience; practice still works without storage
  }
}
