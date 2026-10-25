import { describe, expect, it } from 'vitest';
import { CRC32_RESIDUE, crc32, pseudoHeader, verifyInternetChecksum } from '../checksum.ts';
import { packetFromFrame } from '../encode.ts';
import { defaultSimConfig, simulate, type SimConfig, type SimRun } from './simulate.ts';
import { TEMPLATES, arpCaches, inPrefix, lookup } from './topology.ts';
import { validateSimConfig } from './validate.ts';

const routed = (o: Partial<SimConfig> = {}, protocol: 'TCP' | 'UDP' = 'UDP'): SimConfig => ({ ...defaultSimConfig('routed', protocol), ...o });
const mac = (b: readonly number[], at: number) => b.slice(at, at + 6).map((x) => x.toString(16).padStart(2, '0')).join(':');
const ip = (b: readonly number[], at: number) => b.slice(at, at + 4).join('.');
const u16 = (b: readonly number[], at: number) => (b[at] ?? 0) * 256 + (b[at + 1] ?? 0);

/** Frames of one packet as transmitted on each link, in order. */
const hops = (run: SimRun, pid: string) => run.events.filter((e) => e.type === 'transmit' && e.packetId === pid);

describe('routed topology fixture (RFC 5737, per-interface addresses)', () => {
  const t = TEMPLATES.routed;
  it('every via-gateway is on a directly connected subnet of its egress interface', () => {
    for (const d of Object.values(t.devices))
      for (const r of d.routes) {
        if (r.kind !== 'via') continue;
        const i = d.ifaces.find((x) => x.name === r.iface);
        expect(i && inPrefix(r.gateway, i.ip, i.prefixLength), `${d.id} ${r.gateway}`).toBe(true);
      }
  });
  it('every device can reach both endpoints (forward and reverse routes), and ARP knows each next hop', () => {
    const arp = arpCaches(t);
    for (const d of Object.keys(t.devices))
      for (const dst of ['192.0.2.10', '203.0.113.20']) {
        const rc = lookup(t, d, dst);
        if (d === 'A' && dst === '192.0.2.10') continue;
        if (d === 'B' && dst === '203.0.113.20') continue;
        expect(rc, `${d}→${dst}`).not.toBeNull();
        expect(arp[d]?.[rc?.nextHop ?? ''], `${d} ARP ${rc?.nextHop}`).toBeDefined();
      }
  });
  it('point-to-point links are their own subnets; /30 transit for R1–R2', () => {
    expect(lookup(t, 'R1', '203.0.113.20')?.nextHop).toBe('198.51.100.2');
    expect(lookup(t, 'R2', '192.0.2.10')?.nextHop).toBe('198.51.100.1');
    expect(lookup(t, 'A', '203.0.113.20')?.nextHop).toBe('192.0.2.1');
    expect(lookup(t, 'B', '192.0.2.10')?.nextHop).toBe('203.0.113.1');
    expect(lookup(t, 'R1', '198.51.100.3')?.route.prefixLength).toBe(30);
    expect(lookup(t, 'R1', '10.0.0.1')).toBeNull(); // no default route on routers
  });
});

describe('routed delivery (UDP)', () => {
  const run = simulate(routed());
  const req = hops(run, 'p1');

  it('three link traversals and two router TTL decrements', () => {
    expect(req.map((e) => [e.device, e.timing?.bps])).toEqual([['A', 100e6], ['R1', 10e6], ['R2', 100e6]]);
    const fwd = run.events.filter((e) => e.packetId === 'p1' && e.type === 'forward');
    expect(fwd.map((e) => [e.device, e.explainArgs.ttlFrom, e.explainArgs.ttlTo])).toEqual([['R1', 64, 63], ['R2', 63, 62]]);
    expect(req.map((e) => e.bytes?.[22])).toEqual([64, 63, 62]);
  });

  it('per hop: new MACs and FCS; endpoint IPs, ports and transport bytes unchanged; IP checksum changes', () => {
    const f = req.map((e) => e.bytes ?? []);
    expect(f.map((b) => [mac(b, 6), mac(b, 0)])).toEqual([
      ['02:00:00:00:0a:10', '02:00:00:00:01:00'],
      ['02:00:00:00:01:01', '02:00:00:00:02:00'],
      ['02:00:00:00:02:01', '02:00:00:00:0c:20'],
    ]);
    for (const b of f) {
      expect(crc32(Uint8Array.from(b))).toBe(CRC32_RESIDUE);
      expect([ip(b, 26), ip(b, 30), u16(b, 34), u16(b, 36)]).toEqual(['192.0.2.10', '203.0.113.20', 50000, 7007]);
    }
    expect(new Set(f.map((b) => b.slice(-4).join())).size).toBe(3); // FCS differs per hop
    expect(new Set(f.map((b) => u16(b, 24))).size).toBe(3); // IPv4 header checksum differs per hop
    const segs = f.map((b) => Array.from(packetFromFrame(Uint8Array.from(b)).slice(20)));
    expect(segs[1]).toEqual(segs[0]);
    expect(segs[2]).toEqual(segs[0]);
    for (const b of f) {
      const p = packetFromFrame(Uint8Array.from(b));
      expect(verifyInternetChecksum(p.slice(0, 20))).toBe(true);
      expect(verifyInternetChecksum(pseudoHeader(p.slice(12, 16), p.slice(16, 20), 17, p.length - 20), p.slice(20))).toBe(true);
    }
  });

  it('the receiving host does not decrement TTL', () => {
    const v = run.events.find((e) => e.device === 'B' && e.tag === 'verify:internet' && e.packetId === 'p1');
    expect(v?.explainArgs.ttl).toBe(62);
    expect(run.events.some((e) => e.device === 'B' && e.type === 'forward')).toBe(false);
  });

  it('route lookups explain egress, next hop and the prepopulated ARP cache', () => {
    const lk = run.events.filter((e) => e.packetId === 'p1' && e.tag === 'route:lookup');
    expect(lk.map((e) => [e.device, e.explainArgs.nextHop, e.explainArgs.mac])).toEqual([
      ['A', '192.0.2.1', '02:00:00:00:01:00'],
      ['R1', '198.51.100.2', '02:00:00:00:02:00'],
      ['R2', '203.0.113.20', '02:00:00:00:0c:20'],
    ]);
    expect(String(lk[0]?.explainArgs.arp)).toContain('NOT BUILT');
  });

  it('the reply follows the reverse route and is delivered', () => {
    expect(hops(run, 'p2').map((e) => e.device)).toEqual(['B', 'R2', 'R1']);
    const rep = hops(run, 'p2').map((e) => e.bytes ?? []);
    expect(rep.map((b) => [ip(b, 26), ip(b, 30)])).toEqual(Array(3).fill(['203.0.113.20', '192.0.2.10']));
    expect(new TextDecoder().decode(Uint8Array.from(run.timeline.final.endpoints.A?.recvBuffer ?? []))).toBe('World');
  });
});

describe('routed TCP is end-to-end', () => {
  it('handshake happens only at the endpoints; routers never change TCP state; numbers unchanged', () => {
    const run = simulate(routed({}, 'TCP'));
    const tcpDevs = new Set(run.events.filter((e) => e.transition?.machine === 'tcp').map((e) => e.device));
    expect([...tcpDevs].sort()).toEqual(['A', 'B']);
    expect(run.events.filter((e) => e.tag === 'tcp:state:ESTABLISHED')).toHaveLength(2);
    const f = run.timeline.final.endpoints;
    expect([f.A?.sndNxt, f.A?.rcvNxt, f.B?.sndNxt, f.B?.rcvNxt]).toEqual([1006, 5006, 5006, 1006]);
    // 7 segments × 3 links
    expect(run.events.filter((e) => e.type === 'transmit')).toHaveLength(21);
  });
});

describe('TTL expiry', () => {
  it('TTL 1 expires at the first router: local drop, no delivery, no ICMP', () => {
    const run = simulate(routed({ ttl: 1 }));
    const tags = run.events.map((e) => e.tag);
    const drop = run.events.find((e) => e.tag === 'drop:ttl');
    expect(drop?.device).toBe('R1');
    expect(tags).not.toContain('hop:R1:egress');
    expect(tags).not.toContain('deliver:app');
    expect(tags.some((x) => /icmp/i.test(x))).toBe(false);
    expect(run.timeline.final.packets.p1?.status).toBe('dropped');
    expect(hops(run, 'p1')).toHaveLength(1);
  });
  it('TTL 2 expires at R2', () => {
    const run = simulate(routed({ ttl: 2 }));
    expect(run.events.find((e) => e.tag === 'drop:ttl')?.device).toBe('R2');
    expect(hops(run, 'p1')).toHaveLength(2);
  });
  it('TTL 3 is just enough; the receiver gets TTL 1', () => {
    const run = simulate(routed({ ttl: 3 }));
    expect(run.events.find((e) => e.device === 'B' && e.tag === 'verify:internet')?.explainArgs.ttl).toBe(1);
    expect(run.events.map((e) => e.tag)).toContain('deliver:app');
  });
  it('same-LAN has one traversal and no forwarding; TTL 1 is fine there', () => {
    const run = simulate({ ...defaultSimConfig('same-lan', 'UDP'), ttl: 1 });
    expect(hops(run, 'p1')).toHaveLength(1);
    expect(run.events.some((e) => e.type === 'forward')).toBe(false);
    expect(run.events.map((e) => e.tag)).toContain('deliver:app');
  });
  it('TTL is validated as 1–255', () => {
    expect(validateSimConfig(routed({ ttl: 0 })).map((i) => i.field)).toEqual(['ttl']);
    expect(validateSimConfig(routed({ ttl: 256 })).map((i) => i.field)).toEqual(['ttl']);
  });
});

describe('validation messages are rule-specific', () => {
  const same = defaultSimConfig('same-lan', 'UDP');
  it('duplicate IP vs different subnet vs duplicate MAC', () => {
    const msg = (o: Partial<SimConfig['endpoints']['server']>) =>
      validateSimConfig({ ...same, endpoints: { ...same.endpoints, server: { ...same.endpoints.server, ...o } } })[0]?.message ?? '';
    expect(msg({ ip: '192.0.2.10' })).toContain('different IPv4');
    expect(msg({ ip: '198.51.100.20' })).toContain('/24');
    expect(msg({ mac: '02:00:00:00:0a:10' })).toContain('different MAC');
  });
});
