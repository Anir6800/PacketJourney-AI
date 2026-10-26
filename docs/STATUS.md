# Status

## Phase 07 · Close and application session — COMPLETE (2026-10-26)

### Completed
- TCP normal close (`shared/src/sim/tcp.ts`, `simulate.ts`): client FIN → server ACK → server FIN → client ACK; FIN-WAIT-1/2, CLOSE-WAIT, LAST-ACK, TIME-WAIT, CLOSED in the shared transition table; each FIN consumes one sequence number; FIN RTO retransmission; lost final ACK → FIN retransmit, re-ACK, TIME-WAIT restart; configured EDUCATIONAL TIME-WAIT (default 400 ms). Orderly no-data close (empty raw message + close).
- HTTP session (`http.ts`, `session.ts`): real CRLF HTTP/1.1 request/response strings, Content-Length in UTF-8 bytes, Set-Cookie on A, Cookie on B, in-memory server session table; connection B on client port +1; cookie choice valid / missing / invalid.
- UI: Payload select (Raw / HTTP; HTTP disabled for UDP with the reason), close checkbox + TIME-WAIT input, Connection B cookie select, Session panel (A/B switch, four-tuples, verdict, issued id, session table, cookie jar, CRLF-visible messages, EDUCATIONAL / unencrypted / TLS NOT BUILT labels); TCP cards show the TIME-WAIT timer and all modelled states.

### Commands and results
`npm run verify`: typecheck 0, lint 0, vitest 189/189, build ok (134.21 kB gzip initial), secrets clean, Playwright 21/21 (second full run; the first had the boot-test failure below). Details: `TEST_EVIDENCE.md`.

### Open issues
- Boot e2e test (4 s wall-clock wait) failed on the first verify and 2/3 isolated runs right after the change; passed 3/3 at HEAD and then 9/9 + full verify with the change. Suspected cold Vite transform; not fixed, assertion unchanged.
- ARP exchange, ICMP, RST, simultaneous close (CLOSING), TLS, fault UI, cue builder, GSAP master timeline, playback clock, 3D journey: NOT BUILT.
- WebGL context-loss and hidden-tab drift still untested.

## Next phase: **08**

## Phase 06 · Routed delivery and scopes — COMPLETE (2026-10-26)

### Completed
- Topology: fixed Sender → R1 → R2 → Receiver fixture and Same-LAN alternative, RFC 5737 addresses, per-interface MACs, /30 transit link, explicit forward and reverse route tables, longest-prefix `lookup`, prepopulated `arpCaches`.
- Engine: hop-by-hop forwarding from route tables (no fixed path); `route:lookup` events; routers verify frame, decapsulate, check IPv4, drop on TTL ≤ 1 (`drop:ttl`, no ICMP), decrement TTL, recompute header checksum, build new frame/FCS; hosts never decrement TTL; replies use reverse routes; no NAT; TTL configurable (1–255).
- UI: Initial TTL input; 4-node SVG journey; scope selector (Process / Host / Hop) with arc, dimming, link highlight and a scope panel reading IPs/TTL/MACs/FCS from the current frame, ARP assumption, per-device route table with matched route; Delivery scopes tab points to the overlays.
- Bundle: zod removed from web (129.51 kB gzip initial).

### Commands and results
`npm run verify`: typecheck 0, lint 0, vitest 168/168, build ok (129.51 kB gzip initial), secrets clean, Playwright 20/20. Details: `TEST_EVIDENCE.md`.

### Open issues
- Git checkpoint: commit 3fb1ce8 (re-verified 2026-10-26: verify green, vitest 168/168, Playwright 20/20).
- ARP exchange, ICMP (Time Exceeded, Port/Destination Unreachable), TCP close/RST, fault UI, cue builder, GSAP master timeline, playback clock, 3D journey: NOT BUILT.
- WebGL context-loss and hidden-tab drift still untested.

