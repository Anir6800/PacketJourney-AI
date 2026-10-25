/**
 * RFC 1071 Internet checksum: one's-complement of the one's-complement sum of 16-bit big-endian words.
 * An odd trailing byte is padded with a zero byte for the arithmetic only (nothing is transmitted).
 */
export function onesComplementSum(...chunks: Uint8Array[]): number {
  let sum = 0;
  let hi: number | null = null; // carries an odd byte across chunk boundaries
  for (const c of chunks) {
    for (const b of c) {
      if (hi === null) hi = b;
      else {
        sum += (hi << 8) | b;
        hi = null;
      }
    }
  }
  if (hi !== null) sum += hi << 8;
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return sum;
}

export const internetChecksum = (...chunks: Uint8Array[]): number => ~onesComplementSum(...chunks) & 0xffff;

/** True when data including its checksum field sums to 0xFFFF. */
export const verifyInternetChecksum = (...chunks: Uint8Array[]): boolean => onesComplementSum(...chunks) === 0xffff;

/** RFC 768: a computed UDP checksum of 0 is transmitted as 0xFFFF; 0 on the wire means "not supplied". */
export const udpWireChecksum = (computed: number): number => (computed === 0 ? 0xffff : computed);

export function pseudoHeader(src: Uint8Array, dst: Uint8Array, protocol: number, length: number): Uint8Array {
  return Uint8Array.from([...src, ...dst, 0, protocol, length >> 8, length & 0xff]);
}

// CRC-32 (IEEE 802.3): reflected polynomial 0xEDB88320, init 0xFFFFFFFF, final XOR 0xFFFFFFFF.
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = (TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * FCS serialization convention: the CRC value is written least-significant octet first, which is the
 * octet order on the wire and in captures (e.g. CRC 0xAABBCCDD → bytes DD CC BB AA).
 */
export const fcsBytes = (crc: number): Uint8Array => Uint8Array.from([crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, crc >>> 24]);

/** CRC-32 over a frame including a correct LE FCS always yields this residue. */
export const CRC32_RESIDUE = 0x2144df1c;
