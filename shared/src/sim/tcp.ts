// Scoped TCP connection state machine (RFC 9293 §3.3.2, Figure 5): open/handshake plus the normal
// active/passive close. Simultaneous close (CLOSING) and RST are NOT BUILT. The engine and the UI diagram both read this table.

export const TCP_STATES = [
  'CLOSED', 'LISTEN', 'SYN-SENT', 'SYN-RECEIVED', 'ESTABLISHED', 'FIN-WAIT-1', 'FIN-WAIT-2', 'CLOSE-WAIT', 'LAST-ACK', 'TIME-WAIT',
] as const;
export type TcpState = (typeof TCP_STATES)[number];

export const TCP_TRANSITIONS = [
  { from: 'CLOSED', to: 'LISTEN', on: 'passive OPEN', send: '—' },
  { from: 'CLOSED', to: 'SYN-SENT', on: 'active OPEN', send: 'SYN' },
  { from: 'LISTEN', to: 'SYN-RECEIVED', on: 'rcv SYN', send: 'SYN, ACK' },
  { from: 'SYN-SENT', to: 'ESTABLISHED', on: 'rcv SYN, ACK', send: 'ACK' },
  { from: 'SYN-RECEIVED', to: 'ESTABLISHED', on: 'rcv ACK of SYN', send: '—' },
  { from: 'ESTABLISHED', to: 'FIN-WAIT-1', on: 'CLOSE', send: 'FIN' },
  { from: 'ESTABLISHED', to: 'CLOSE-WAIT', on: 'rcv FIN', send: 'ACK' },
  { from: 'FIN-WAIT-1', to: 'FIN-WAIT-2', on: 'rcv ACK of FIN', send: '—' },
  { from: 'CLOSE-WAIT', to: 'LAST-ACK', on: 'CLOSE', send: 'FIN' },
  { from: 'FIN-WAIT-2', to: 'TIME-WAIT', on: 'rcv FIN', send: 'ACK' },
  { from: 'LAST-ACK', to: 'CLOSED', on: 'rcv ACK of FIN', send: '—' },
  { from: 'TIME-WAIT', to: 'CLOSED', on: 'TIME-WAIT timer expires', send: '—' },
] as const satisfies readonly { from: TcpState; to: TcpState; on: string; send: string }[];

export function checkTransition(from: string, to: TcpState): void {
  if (!TCP_TRANSITIONS.some((t) => t.from === from && t.to === to)) throw new Error(`illegal TCP transition ${from} → ${to}`);
}

/** TCP control bits in header byte 13. */
export const TCP_FLAG = { FIN: 0x01, SYN: 0x02, RST: 0x04, PSH: 0x08, ACK: 0x10 } as const;

export function flagNames(byte13: number): string {
  return (['SYN', 'ACK', 'PSH', 'FIN', 'RST'] as const).filter((n) => byte13 & TCP_FLAG[n]).join(', ') || 'none';
}

export const U32 = 2 ** 32;
/** Unsigned 32-bit sequence arithmetic (RFC 9293 §3.4: all arithmetic modulo 2^32). */
export const seqAdd = (a: number, n: number) => (((a + n) % U32) + U32) % U32;
