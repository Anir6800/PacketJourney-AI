# Status

## Phase 05 · TCP connect and data — COMPLETE (2026-10-26)

### Completed
- `shared/src/sim/tcp.ts`: scoped RFC 9293 state table (CLOSED, LISTEN, SYN-SENT, SYN-RECEIVED, ESTABLISHED), transition check, flag decoding, mod-2^32 sequence add.
- Engine: server passive open, client active open with SYN; SYN-ACK; handshake ACK; app data queued until ESTABLISHED; byte-based SEQ/ACK with configurable teaching ISNs (1000/5000); SYN consumes 1, data its UTF-8 bytes, pure ACK 0; immediate ACK (no delayed ACK/Nagle); 1 ms app delay separates transport ACK from app processing; one data segment per direction; RTO for SYN/SYN-ACK/data; lost handshake ACK and duplicate SYN-ACK handled; ISS/IRS stored per endpoint.
- UI: TCP ISN inputs with validation and teaching note; `TcpCards` (both endpoints' state, ISS/IRS, SND.UNA/SND.NXT/RCV.NXT, send buffer, four-tuple, state pills, transition list with the current one highlighted) inside the 2D journey; SYN/SYN-ACK/ACK packet markers; log shows `TCP header [flags] seq … ack …`.

### Commands and results
`npm run verify`: typecheck 0, lint 0, vitest 153/153, build ok (146.11 kB gzip initial), secrets clean, Playwright 19/19. Details: `TEST_EVIDENCE.md`.

### Open issues
- Not a Git repository → no checkpoint.
- TCP close (FIN, FIN-WAIT, CLOSE-WAIT, LAST-ACK, TIME-WAIT), RST, ICMP, ARP, routing lookup, fault UI, cue builder, GSAP master timeline, playback clock, 3D journey: NOT BUILT.
- Initial JS 146.11 kB gzip vs 150 kB target — ~4 kB headroom.
- WebGL context-loss and hidden-tab drift still untested.

## Next phase: **06**
