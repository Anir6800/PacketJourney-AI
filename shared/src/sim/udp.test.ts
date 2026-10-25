import { describe, expect, it } from 'vitest';
import { packetFromFrame } from '../encode.ts';
import { defaultSimConfig, simulate, type SimConfig } from './simulate.ts';
import { validateSimConfig } from './validate.ts';

const udp = (o: Partial<SimConfig> = {}): SimConfig => ({ ...defaultSimConfig('same-lan', 'UDP'), ...o });
const text = (b: readonly number[] | undefined) => new TextDecoder().decode(Uint8Array.from(b ?? []));
const be = (b: readonly number[], start: number, end: number) => b.slice(start, end).reduce((n, x) => n * 256 + x, 0);

describe('UDP same-LAN vertical slice', () => {
  const run = simulate(udp());
  const tags = run.events.map((e) => e.tag);
  const final = run.timeline.final;

  it('Hello arrives unchanged and the configured reply comes back', () => {
    expect(text(final.endpoints.B?.recvBuffer)).toBe('Hello');
    expect(text(final.endpoints.A?.recvBuffer)).toBe('World');
    expect(final.endpoints.A?.app).toBe('got-response');
    expect(final.end?.reason).toBe('complete');
  });

  it('receiver pipeline: transmit → link verify → IPv4/UDP validation → socket → deliver → app processed', () => {
    const atB = run.events.filter((e) => e.device === 'B' && e.packetId === 'p1').map((e) => e.tag);
    expect(atB).toEqual([
      'hop:B:ingress', 'verify:link', 'decap:link', 'verify:internet', 'decap:internet',
      'verify:transport', 'socket:select', 'decap:transport', 'deliver:app', 'app:processed',
    ]);
    expect(final.packets.p1?.rx).toEqual({ transport: 'accepted', app: 'processed' });
    expect(final.packets.p2?.rx).toEqual({ transport: 'accepted', app: 'processed' });
  });

  it('reply swaps IPs and ports', () => {
    const req = run.events.find((e) => e.packetId === 'p1' && e.type === 'transmit')?.bytes ?? [];
    const rep = run.events.find((e) => e.packetId === 'p2' && e.type === 'transmit')?.bytes ?? [];
    expect(rep.slice(26, 30)).toEqual(req.slice(30, 34)); // src IP ← old dst
    expect(rep.slice(30, 34)).toEqual(req.slice(26, 30));
    expect(be(rep, 34, 36)).toBe(be(req, 36, 38)); // src port ← old dst port
    expect(be(rep, 36, 38)).toBe(be(req, 34, 36));
    expect(rep.slice(0, 6)).toEqual(req.slice(6, 12)); // MACs swapped on the same LAN
  });

  it('never invents TCP-style events for UDP', () => {
    expect(tags.filter((t) => /syn|ack|retransmit|timer|fin|close|duplicate/.test(t))).toEqual([]);
    expect(run.events.some((e) => e.transition?.machine === 'tcp' || e.transition?.machine === 'timer')).toBe(false);
    expect(Object.values(final.endpoints).every((e) => e.tcpState === 'CLOSED' && e.sndNxt === null)).toBe(true);
  });

  it('link and transport byte maps match the encoded buffers', () => {
    const frame = final.units.link ?? [];
    const firstTx = run.events.find((e) => e.packetId === 'p1' && e.type === 'transmit')?.bytes;
    expect(frame).toEqual(firstTx);
    const seg = final.units.transport ?? [];
    expect(Array.from(packetFromFrame(Uint8Array.from(frame)).slice(20))).toEqual(seg);
    for (const f of final.fields) {
      const bytes = frame.slice(f.byteStart, f.byteEnd);
      expect(bytes.length).toBe(f.byteEnd - f.byteStart);
      if (f.raw === null || f.bitOffset % 8 || f.bitWidth % 8 || f.bitWidth > 32) continue;
      // FCS is serialized least-significant octet first (documented convention); all header fields are big-endian.
      const value = f.id === 'fcs.crc32' ? be([...bytes].reverse(), 0, bytes.length) : be(frame, f.byteStart, f.byteEnd);
      expect(value, f.id).toBe(f.raw);
    }
    const udpFields = final.fields.filter((f) => f.header === 'udp');
    expect(udpFields.map((f) => [f.byteStart - 34, f.byteEnd - 34])).toEqual([[0, 2], [2, 4], [4, 6], [6, 8]]);
    expect(be(seg, 4, 6)).toBe(13);
  });

  it('encap events carry field details for the event log', () => {
    const e = run.events.find((x) => x.tag === 'encap:transport');
    expect(e?.explainArgs).toMatchObject({ 'Source port': '50000 (0xC350)', 'Destination port': '7007 (0x1B5F)', Length: '13 (0x000D)' });
  });
});

describe('UDP behaviours', () => {
  it('reply can be disabled', () => {
    const run = simulate(udp({ reply: { enabled: false, text: 'unused' } }));
    const tags = run.events.map((e) => e.tag);
    expect(tags).not.toContain('app:respond');
    expect(tags).toContain('app:processed');
    expect(run.timeline.final.endpoints.A?.recvBuffer).toEqual([]);
    expect(run.events.find((e) => e.tag === 'app:processed')?.explainKey).toBe('app.processed.noreply');
  });

  it('wrong destination port is not delivered to any application', () => {
    const run = simulate(udp({ requestDstPort: 9999 }));
    const tags = run.events.map((e) => e.tag);
    expect(tags).toContain('socket:none');
    expect(tags).not.toContain('deliver:app');
    expect(tags).not.toContain('app:respond');
    expect(run.timeline.final.endpoints.B?.deliveredBytes).toBe(0);
    expect(run.timeline.final.packets.p1?.rx.transport).toBe('rejected');
  });

  it('checksum disabled: 0 on the wire, receiver skips verification', () => {
    const run = simulate(udp({ udpChecksum: false }));
    const seg = run.timeline.final.units.transport ?? [];
    expect(be(seg, 6, 8)).toBe(0);
    expect(run.events.find((e) => e.tag === 'verify:transport')?.explainKey).toBe('verify.transport.udp-none');
    expect(text(run.timeline.final.endpoints.B?.recvBuffer)).toBe('Hello');
  });

  it('user-edited addresses and ports appear in the bytes', () => {
    const c = udp({
      endpoints: { client: { ip: '10.1.2.3', mac: '02:aa:bb:cc:dd:01', port: 40000 }, server: { ip: '10.1.2.99', mac: '02:aa:bb:cc:dd:02', port: 6000 } },
      requestDstPort: 6000,
    });
    const run = simulate(c);
    const f = run.timeline.final.units.link ?? [];
    expect(f.slice(26, 30)).toEqual([10, 1, 2, 3]);
    expect(f.slice(30, 34)).toEqual([10, 1, 2, 99]);
    expect(f.slice(0, 6)).toEqual([2, 0xaa, 0xbb, 0xcc, 0xdd, 2]);
    expect(be(f, 34, 36)).toBe(40000);
    expect(text(run.timeline.final.endpoints.A?.recvBuffer)).toBe('World');
  });
});

describe('validation blocks invalid input', () => {
  const issues = (o: Partial<SimConfig>) => validateSimConfig(udp(o)).map((i) => i.field);
  const ep = (client: Partial<SimConfig['endpoints']['client']>, server: Partial<SimConfig['endpoints']['server']> = {}) => {
    const d = udp().endpoints;
    return { endpoints: { client: { ...d.client, ...client }, server: { ...d.server, ...server } } };
  };
  it('default config is valid', () => expect(issues({})).toEqual([]));
  it.each([
    ['octet > 255', ep({ ip: '192.168.1.256' }), 'client.ip'],
    ['not dotted', ep({ ip: '192.168.1' }), 'client.ip'],
    ['leading zero', ep({ ip: '192.168.01.10' }), 'client.ip'],
    ['loopback', ep({ ip: '127.0.0.1' }), 'client.ip'],
    ['multicast', ep({ ip: '224.0.0.1' }), 'client.ip'],
    ['broadcast host part', ep({ ip: '192.168.1.255' }), 'client.ip'],
    ['multicast MAC', ep({ mac: '01:00:5e:00:00:01' }), 'client.mac'],
    ['broadcast MAC', ep({ mac: 'ff:ff:ff:ff:ff:ff' }), 'client.mac'],
    ['zero MAC', ep({ mac: '00:00:00:00:00:00' }), 'client.mac'],
    ['bad MAC syntax', ep({ mac: '02-00-5e-a1-00-0a' }), 'client.mac'],
    ['port 0', ep({ port: 0 }), 'client.port'],
    ['port 65536', ep({}, { port: 65536 }), 'server.port'],
    ['non-integer port', ep({ port: Number.NaN }), 'client.port'],
    ['duplicate IP', ep({}, { ip: '192.168.1.10' }), 'server.ip'],
    ['duplicate MAC', ep({}, { mac: '02:00:5e:a1:00:0a' }), 'server.mac'],
    ['different /24 on same LAN', ep({}, { ip: '192.168.2.20' }), 'server.ip'],
  ])('%s', (_, o, field) => {
    expect(issues(o)).toContain(field);
    expect(() => simulate(udp(o))).toThrow();
  });
  it('destination port and reply text are validated', () => {
    expect(issues({ requestDstPort: 0 })).toContain('requestDstPort');
    expect(issues({ reply: { enabled: true, text: '' } })).toContain('reply.text');
    expect(issues({ reply: { enabled: false, text: '' } })).toEqual([]);
  });
  it('routed template ignores (fixed) addresses, still checks ports', () => {
    const c = { ...defaultSimConfig('routed', 'UDP'), requestDstPort: 70000 };
    expect(validateSimConfig(c).map((i) => i.field)).toEqual(['requestDstPort']);
  });
});
