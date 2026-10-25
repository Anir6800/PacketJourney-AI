# Status

## Phase 06 · Routed delivery and scopes — COMPLETE (2026-10-26)

### Completed
- Topology: fixed Sender → R1 → R2 → Receiver fixture and Same-LAN alternative, RFC 5737 addresses, per-interface MACs, /30 transit link, explicit forward and reverse route tables, longest-prefix `lookup`, prepopulated `arpCaches`.
- Engine: hop-by-hop forwarding from route tables (no fixed path); `route:lookup` events; routers verify frame, decapsulate, check IPv4, drop on TTL ≤ 1 (`drop:ttl`, no ICMP), decrement TTL, recompute header checksum, build new frame/FCS; hosts never decrement TTL; replies use reverse routes; no NAT; TTL configurable (1–255).
- UI: Initial TTL input; 4-node SVG journey; scope selector (Process / Host / Hop) with arc, dimming, link highlight and a scope panel reading IPs/TTL/MACs/FCS from the current frame, ARP assumption, per-device route table with matched route; Delivery scopes tab points to the overlays.
- Bundle: zod removed from web (129.51 kB gzip initial).

### Commands and results
`npm run verify`: typecheck 0, lint 0, vitest 168/168, build ok (129.51 kB gzip initial), secrets clean, Playwright 20/20. Details: `TEST_EVIDENCE.md`.

### Open issues
- Not a Git repository → no checkpoint.
- ARP exchange, ICMP (Time Exceeded, Port/Destination Unreachable), TCP close/RST, fault UI, cue builder, GSAP master timeline, playback clock, 3D journey: NOT BUILT.
- WebGL context-loss and hidden-tab drift still untested.

## Next phase: **07**
