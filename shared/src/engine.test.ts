import { describe, expect, it } from 'vitest';
import {
  CRC32_RESIDUE,
  checkPayload,
  crc32,
  demoScenario,
  encode,
  internetChecksum,
  pseudoHeader,
  representations,
  udpWireChecksum,
  utf8,
  verifyInternetChecksum,
  type ScenarioConfig,
} from './index.ts';

const h = (s: string) => Uint8Array.from(s.trim().split(/\s+/).map((x) => parseInt(x, 16)));
const w = (b: Uint8Array, i: number) => ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// Independent reference: concatenate, pad, sum words with a plain accumulator, fold once at the end.
function refChecksum(...parts: Uint8Array[]): number {
  const all = parts.flatMap((p) => Array.from(p));
  if (all.length % 2) all.push(0);
  let sum = 0;
  for (let i = 0; i < all.length; i += 2) sum += (all[i] ?? 0) * 256 + (all[i + 1] ?? 0);
  while (sum >> 16) sum = (sum % 65536) + Math.floor(sum / 65536);
  return 0xffff - sum;
}

const enc = (text: string, protocol: 'TCP' | 'UDP', scope: 'link' | 'routed' = 'routed', udpChecksum = true) => {
  const c = demoScenario({ seed: 42, text, protocol, scope, udpChecksum });
  return { c, e: encode(c, utf8(text)) };
};

describe('UTF-8', () => {
  it('Hello is five bytes', () => {
    expect(Array.from(utf8('Hello'))).toEqual([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
  });
  it('non-ASCII matches TextEncoder and known code unit bytes', () => {
    const s = 'héllo ✓ 😀';
    expect(Array.from(utf8(s))).toEqual(Array.from(new TextEncoder().encode(s)));
    expect(Array.from(utf8('é'))).toEqual([0xc3, 0xa9]); // U+00E9
    expect(Array.from(utf8('✓'))).toEqual([0xe2, 0x9c, 0x93]); // U+2713
    expect(Array.from(utf8('😀'))).toEqual([0xf0, 0x9f, 0x98, 0x80]); // U+1F600
    expect('😀'.length).toBe(2); // JS length is UTF-16 units, not bytes
  });
  it('representations group bytes by code point with consistent offsets', () => {
    const r = representations('a😀é');
    expect(r.map((x) => [x.char, x.byteStart, x.bytes.length])).toEqual([
      ['a', 0, 1],
      ['😀', 1, 4],
      ['é', 5, 2],
    ]);
  });
  it('validates 1–256 bytes without truncating', () => {
    expect(checkPayload('').ok).toBe(false);
    expect(checkPayload('x'.repeat(256)).ok).toBe(true);
    const over = checkPayload('é'.repeat(129)); // 129 chars, 258 bytes
    expect(over).toMatchObject({ ok: false, byteLength: 258 });
  });
});

describe('RFC 1071 Internet checksum', () => {
  it('RFC 1071 §3 example: sum 0xDDF2 → checksum 0x220D', () => {
    expect(internetChecksum(h('00 01 f2 03 f4 f5 f6 f7'))).toBe(0x220d);
  });
  it('published IPv4 header vector → 0xB861', () => {
    expect(internetChecksum(h('45 00 00 73 00 00 40 00 40 11 00 00 c0 a8 00 01 c0 a8 00 c7'))).toBe(0xb861);
    expect(verifyInternetChecksum(h('45 00 00 73 00 00 40 00 40 11 b8 61 c0 a8 00 01 c0 a8 00 c7'))).toBe(true);
  });
  it('odd length pads with zero for arithmetic only', () => {
    expect(internetChecksum(h('01'))).toBe(0xfeff);
    expect(internetChecksum(h('ab cd ef'))).toBe(refChecksum(h('ab cd ef')));
  });
  it('odd byte carried across chunk boundaries', () => {
    expect(internetChecksum(h('12'), h('34 56'), h('78 9a'))).toBe(refChecksum(h('12 34 56 78 9a')));
  });
  it('UDP: computed 0 is transmitted as 0xFFFF', () => {
    expect(udpWireChecksum(0)).toBe(0xffff);
    expect(udpWireChecksum(0x1234)).toBe(0x1234);
  });
});

describe('CRC-32 (IEEE 802.3)', () => {
  it('standard check values', () => {
    expect(crc32(new Uint8Array())).toBe(0);
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(crc32(ascii('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });
});

describe('Header encoding (network byte order)', () => {
  it('UDP length 13 and IPv4 total length 33 for Hello', () => {
    const { e } = enc('Hello', 'UDP');
    expect(e.segment.length).toBe(13);
    expect(w(e.segment, 4)).toBe(13);
    expect(e.packet.length).toBe(33);
    expect(w(e.packet, 2)).toBe(33);
    expect(e.packet[9]).toBe(17);
  });
  it('IPv4 total length 45 for TCP Hello; data offset 5; ACK+PSH', () => {
    const { e } = enc('Hello', 'TCP');
    expect(e.packet.length).toBe(45);
    expect(w(e.packet, 2)).toBe(45);
    expect(e.packet[9]).toBe(6);
    expect((e.segment[12] ?? 0) >> 4).toBe(5);
    expect(e.segment[13]).toBe(0b0001_1000); // CWR ECE URG ACK PSH RST SYN FIN
  });
  it('minimum padded Ethernet frame is 64 bytes including FCS', () => {
    for (const p of ['UDP', 'TCP'] as const) {
      const { e } = enc('Hello', p);
      expect(e.frame.length).toBe(64);
      expect(e.padding).toBe(46 - e.packet.length);
      // IPv4 total length excludes padding
      expect(w(e.frame, 16)).toBe(e.packet.length);
    }
    const big = enc('x'.repeat(100), 'UDP').e;
    expect(big.padding).toBe(0);
    expect(big.frame.length).toBe(14 + 20 + 8 + 100 + 4);
  });
  it('frame layout: EtherType 0x0800, version/IHL 0x45, addresses', () => {
    const { e, c } = enc('Hello', 'UDP');
    expect(Array.from(e.frame.slice(12, 14))).toEqual([0x08, 0x00]);
    expect(e.frame[14]).toBe(0x45);
    expect(Array.from(e.frame.slice(26, 30)).join('.')).toBe(c.src.ip);
    expect(Array.from(e.frame.slice(30, 34)).join('.')).toBe(c.dst.ip);
    expect(e.frame[22]).toBe(64); // TTL
  });
  it('checksums match the independent reference', () => {
    for (const p of ['UDP', 'TCP'] as const) {
      for (const text of ['Hello', 'Hi!', 'héllo ✓']) {
        const { e } = enc(text, p);
        const ip = e.packet.slice(0, 20);
        const ipNoCs = ip.slice();
        ipNoCs[10] = ipNoCs[11] = 0;
        expect(w(ip, 10)).toBe(refChecksum(ipNoCs));
        const seg = e.segment.slice();
        const at = p === 'TCP' ? 16 : 6;
        const sent = w(seg, at);
        seg[at] = seg[at + 1] = 0;
        const ref = refChecksum(pseudoHeader(ip.slice(12, 16), ip.slice(16, 20), p === 'TCP' ? 6 : 17, seg.length), seg);
        expect(sent).toBe(p === 'UDP' ? udpWireChecksum(ref) : ref);
      }
    }
  });
  it('UDP checksum disabled transmits 0', () => {
    const { e } = enc('Hello', 'UDP', 'routed', false);
    expect(w(e.segment, 6)).toBe(0);
  });
  it('UDP computed checksum 0 goes on the wire as 0xFFFF', () => {
    const c = demoScenario({ seed: 1, text: 'xx', protocol: 'UDP', scope: 'link' });
    const probe = encode(c, new Uint8Array(2));
    // Choose payload word = checksum with zero payload → sum becomes 0xFFFF → computed checksum 0.
    const cs = w(probe.segment, 6);
    const e = encode(c, Uint8Array.from([cs >> 8, cs & 0xff]));
    expect(w(e.segment, 6)).toBe(0xffff);
  });
  it('FCS: LE serialization and CRC residue over the whole frame', () => {
    const { e } = enc('Hello', 'TCP');
    expect(crc32(e.frame.slice(0, -4))).toBe(e.fcs);
    expect(e.frame[e.frame.length - 4]).toBe(e.fcs & 0xff);
    expect(crc32(e.frame)).toBe(CRC32_RESIDUE);
  });
});

describe('bit-flip rejection', () => {
  const flip = (b: Uint8Array, byte: number, bit = 0) => {
    const x = b.slice();
    x[byte] = (x[byte] ?? 0) ^ (1 << bit);
    return x;
  };
  it('every single-bit flip in the IPv4 header is detected', () => {
    const { e } = enc('Hello', 'UDP');
    const ip = e.packet.slice(0, 20);
    expect(verifyInternetChecksum(ip)).toBe(true);
    for (let i = 0; i < 20; i++) for (let b = 0; b < 8; b++) expect(verifyInternetChecksum(flip(ip, i, b))).toBe(false);
  });
  it('payload flip breaks the transport checksum (odd length)', () => {
    for (const p of ['UDP', 'TCP'] as const) {
      const { e } = enc('Hi!', p);
      const ph = (seg: Uint8Array) => pseudoHeader(e.packet.slice(12, 16), e.packet.slice(16, 20), p === 'TCP' ? 6 : 17, seg.length);
      expect(verifyInternetChecksum(ph(e.segment), e.segment)).toBe(true);
      const bad = flip(e.segment, e.segment.length - 1, 3);
      expect(verifyInternetChecksum(ph(bad), bad)).toBe(false);
    }
  });
  it('any frame bit flip breaks the FCS residue', () => {
    const { e } = enc('Hello', 'UDP');
    for (let i = 0; i < e.frame.length; i += 7) expect(crc32(flip(e.frame, i, i % 8))).not.toBe(CRC32_RESIDUE);
  });
});

describe('field map', () => {
  for (const p of ['UDP', 'TCP'] as const) {
    it(`${p}: fields tile the frame exactly, bits within bytes, stable order`, () => {
      const { e } = enc('Hello', p);
      const byPos = [...e.fields].sort((a, b) => a.bitOffset - b.bitOffset);
      let bit = 0;
      for (const f of byPos) {
        expect(f.bitOffset).toBe(bit);
        expect(f.byteStart).toBe(Math.floor(f.bitOffset / 8));
        expect(f.byteEnd).toBe(Math.ceil((f.bitOffset + f.bitWidth) / 8));
        bit += f.bitWidth;
      }
      expect(bit).toBe(e.frame.length * 8);
      expect(e.fields.map((f) => f.order)).toEqual(e.fields.map((_, i) => i));
      expect(e.fields[0]?.id).toBe('payload.data');
      expect(e.fields.at(-1)?.id).toBe('fcs.crc32');
      const tl = e.fields.find((f) => f.id === 'ipv4.totalLength');
      expect([tl?.byteStart, tl?.byteEnd, tl?.raw]).toEqual([16, 18, p === 'UDP' ? 33 : 45]);
    });
  }
  it('field ids are unique', () => {
    for (const p of ['UDP', 'TCP'] as const) {
      const ids = enc('Hello', p).e.fields.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
  it('non-modelled TCP flags are illustrative zeros and say so', () => {
    const { e } = enc('Hello', 'TCP');
    for (const id of ['tcp.cwr', 'tcp.ece', 'tcp.urg', 'tcp.urgent']) {
      const f = e.fields.find((x) => x.id === id);
      expect(f?.status).toBe('illustrative');
      expect(f?.raw).toBe(0);
      expect(f?.explanation).toContain('Not modelled');
    }
  });
  it('field ids/order are stable across payloads', () => {
    const ids = (t: string) => enc(t, 'TCP').e.fields.map((f) => f.id);
    expect(ids('x'.repeat(200))).toEqual(ids('Hello').filter((i) => i !== 'padding.bytes'));
  });
});

describe('seeding', () => {
  it('explicit seq/ack/ipId override the PRNG', () => {
    const base = demoScenario({ seed: 7, text: 'Hello', protocol: 'TCP', scope: 'routed' });
    const c: ScenarioConfig = { ...base, ipId: 0x1234, transport: { protocol: 'TCP', window: 1000, flags: { ack: true, psh: true, rst: false, syn: false, fin: false }, seq: 1, ack: 2 } };
    const e = encode(c, utf8('Hello'));
    expect(w(e.segment, 4)).toBe(0);
    expect(w(e.segment, 6)).toBe(1);
    expect(w(e.segment, 10)).toBe(2);
    expect(w(e.packet, 4)).toBe(0x1234);
  });
  it('different seeds change seq/ID but not lengths', () => {
    const x = encode(demoScenario({ seed: 1, text: 'Hello', protocol: 'TCP', scope: 'routed' }), utf8('Hello'));
    const y = encode(demoScenario({ seed: 2, text: 'Hello', protocol: 'TCP', scope: 'routed' }), utf8('Hello'));
    expect(x.frame.length).toBe(y.frame.length);
    expect(x.segment.slice(4, 8)).not.toEqual(y.segment.slice(4, 8));
  });
});
