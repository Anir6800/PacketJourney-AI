import { PAYLOAD_MAX, PAYLOAD_MIN } from './schemas.ts';

const enc = new TextEncoder();

/** UTF-8 bytes. Network length is bytes.length, never string.length. */
export const utf8 = (text: string): Uint8Array => enc.encode(text);

export const hex = (b: number, width = 2) => b.toString(16).toUpperCase().padStart(width, '0');
export const bin = (b: number) => b.toString(2).padStart(8, '0');

export type CodePointBytes = { char: string; codePoint: number; bytes: number[]; byteStart: number };

/** Synchronised text / hex / binary view, grouped by Unicode code point. */
export function representations(text: string): CodePointBytes[] {
  const out: CodePointBytes[] = [];
  let at = 0;
  for (const char of text) {
    const bytes = Array.from(utf8(char));
    out.push({ char, codePoint: char.codePointAt(0) ?? 0, bytes, byteStart: at });
    at += bytes.length;
  }
  return out;
}

export type PayloadCheck = { ok: true; bytes: Uint8Array } | { ok: false; byteLength: number; error: string };

export function checkPayload(text: string): PayloadCheck {
  const bytes = utf8(text);
  if (bytes.length < PAYLOAD_MIN) return { ok: false, byteLength: 0, error: `Enter at least ${PAYLOAD_MIN} byte.` };
  if (bytes.length > PAYLOAD_MAX)
    return { ok: false, byteLength: bytes.length, error: `${bytes.length} bytes is over the ${PAYLOAD_MAX}-byte limit for one segment/datagram in this version. Nothing was truncated.` };
  return { ok: true, bytes };
}

export const ipBytes = (ip: string) => Uint8Array.from(ip.split('.').map(Number));
export const macBytes = (mac: string) => Uint8Array.from(mac.split(':').map((h) => parseInt(h, 16)));
