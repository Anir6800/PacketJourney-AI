import { utf8 } from '../bytes.ts';
import { prng, u32 } from '../prng.ts';

// Illustrative HTTP/1.1 over TCP (RFC 9112 message syntax, RFC 9110 semantics, RFC 6265 cookies).
// Plain text, unencrypted; TLS is NOT BUILT. Session ids are EDUCATIONAL demo values, not credentials.

export const CRLF = '\r\n';
export const COOKIE_NAME = 'sid';

export type HttpRequestSpec = { path: string; host: string; cookie: string | null };

/** GET request: request line, headers, CRLF CRLF. No body, so no Content-Length. */
export function httpRequest(r: HttpRequestSpec): string {
  const lines = [`GET ${r.path} HTTP/1.1`, `Host: ${r.host}`, ...(r.cookie === null ? [] : [`Cookie: ${COOKIE_NAME}=${r.cookie}`])];
  return lines.join(CRLF) + CRLF + CRLF;
}

/** Response with Content-Length = UTF-8 byte length of the body (not its character count). */
export function httpResponse(body: string, setCookie: string | null): string {
  const lines = [
    'HTTP/1.1 200 OK',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Length: ${utf8(body).length}`,
    ...(setCookie === null ? [] : [`Set-Cookie: ${COOKIE_NAME}=${setCookie}; Path=/; HttpOnly`]),
  ];
  return lines.join(CRLF) + CRLF + CRLF + body;
}

export type ParsedHttp = { startLine: string; headers: Record<string, string>; body: string };

/** Splits at the first CRLF CRLF; header names lower-cased. Returns null if the head is incomplete. */
export function parseHttp(text: string): ParsedHttp | null {
  const end = text.indexOf(CRLF + CRLF);
  if (end < 0) return null;
  const [startLine = '', ...rest] = text.slice(0, end).split(CRLF);
  const headers: Record<string, string> = {};
  for (const l of rest) {
    const i = l.indexOf(':');
    if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
  }
  return { startLine, headers, body: text.slice(end + 4) };
}

export const cookieValue = (header: string | undefined): string | null =>
  header?.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1) ?? null;

/** Deterministic demo id derived from the seed. Not random, not secret, not an auth token. */
export const demoSessionId = (seed: number) => `demo-${u32(prng(seed ^ 0x5e55)).toString(16).padStart(8, '0')}`;

export type SessionVerdict = 'recognized' | 'unrecognized';
export type HttpHandled = { response: string; verdict: SessionVerdict; cookieSent: string | null; issued: string | null; known: string[] };

/**
 * The server app's in-memory session table decides. A known cookie is recognized; a missing or unknown
 * one is unrecognized and a fresh demo id is issued with Set-Cookie.
 */
export function handleHttp(request: string, known: readonly string[], seed: number): HttpHandled {
  const sent = cookieValue(parseHttp(request)?.headers.cookie);
  if (sent !== null && known.includes(sent)) {
    return { response: httpResponse(`Welcome back — session ${sent} recognized.`, null), verdict: 'recognized', cookieSent: sent, issued: null, known: [...known] };
  }
  let id = demoSessionId(seed);
  for (let i = 1; known.includes(id); i++) id = demoSessionId(seed + i);
  const body = sent === null ? `Hello — new session ${id} issued.` : `Unknown session — new session ${id} issued.`;
  return { response: httpResponse(body, id), verdict: 'unrecognized', cookieSent: sent, issued: id, known: [...known, id] };
}
