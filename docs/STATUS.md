# Status

## Phase 10 · Story Mode — COMPLETE (2026-10-26)

### Completed
- Story Mode is the first-run default; Lab is one click away with the same config and run, plus "Replay this run as a story".
- Questions one at a time, each typed then answered with inline validation and Back: message (live UTF-8 byte count), TCP/UDP cards with one-line truthful contrast, ports, same network vs routers, raw vs HTTP (TCP only), fault (none / lose the first data packet once — the only engine-implemented fault; unbuilt ones hidden), confirmation summary.
- Chapters: Encapsulation (one beat per layer, Inspect rig, key fields with real values in the inspector), Journey (handshake/close states, sends, router hops with TTL and MACs, ACKs, deliveries, drops/retransmits), Decapsulation (outermost first with validation results), Recap (three scopes with the overlay, changed vs constant, two engine-answered predictions, Practice link).
- Chapter progress rail, Next/Back/Skip chapter, Auto-play, Restart; Space/Enter/→ and ←; typing 45 chars/s, instantly completable; Reduced motion = full text. Resumable across reloads.
- All captions are templates in `docs/STORY_SCRIPT.md` (67), filled from engine output only.

### Commands and results
`npm run verify` exit 0: typecheck 0, lint 0, vitest 210/210, build ok (initial 149.19 kB gzip, lazy 3D 282.12 kB gzip), secrets clean, Playwright 40/40. Details: `TEST_EVIDENCE.md`.

### Open issues
- Practice tab and its exercises: NOT BUILT (predictions link to the placeholder).
- Story uses the HTTP session's connection A only when HTTP is chosen (connection B is in Lab's session panel).
- The 3D shell list label can clip at the stage's right edge in Overview when the packet sits at the receiver.
- Initial bundle 149.19 kB gzip is 0.8 kB under its 150 kB budget: the next phase must trim or code-split before adding to it.
- AI tutor, ARP, ICMP, RST, CLOSING, TLS: NOT BUILT.

## Next phase: **11**

## Phase 09 · Cinematic motion system — COMPLETE (2026-10-26)

### Completed
- `web/src/motion/cues.ts`: pure cue builder (cueId, eventId, startVT/endVT, startPT/endPT, kind, targets, hold flag), `locate`, ladder `packetSpans`.
- `web/src/motion/clock.ts`: single rAF playback clock (speeds 0.25/0.5/1/2, play/pause/seek/reset, StrictMode-safe).
- `web/src/motion/motion.ts`: paused GSAP master timeline with a label per event id and an end marker; `useMasterChild` for component sub-timelines.
- Dock: reset, previous, play/pause, next, speed, scrubber, live timestamp, teaching-hold label, hidden-tab note. Keyboard shortcuts with guards. Single announcer.
- 3D: shells wrap 1.15 → 1 and release outermost-first, Internet shell TTL flash at routers, packet travels the link with exact send→arrival progress, bit particles flow, ACKs as a smaller capsule with a green ring, Follow-rig eased dolly with holds; all read from refs.
- `CueOverlay`: header flyer from the inspector edge (measured), deterministic checksum/FCS scramble-decode, validation ticks (FCS, IPv4 checksum, transport checksum, port), drops.
- `Ladder`: TCP/UDP ladder between endpoints, arrows drawn in sync, ACK arrows distinct, lost packets end at mid-link with ✕.

### Commands and results
`npm run verify` exit 0: typecheck 0, lint 0, vitest 201/201, build ok (initial 140.87 kB gzip, lazy 3D 282.09 kB gzip), secrets clean, Playwright 35/35. Speed through the real loop: exactly 1.000000 / 2.000000 PT per consumed wall second; 12/12 scrub samples identical. Details: `TEST_EVIDENCE.md`.

### Open issues
- Payload "typing" and shell header-field Flip into the 3D shell are simplified (decoder line + flyer chip); Story Mode narration NOT BUILT.
- Wall-clock playback rates in headless SwiftShader are below real time (frames > 250 ms clamp); viewing rates on real hardware NOT MEASURED.
- The Canvas commits through its own React root; tests wait for the committed step (usually well under 100 ms; up to a few hundred ms under SwiftShader).
- ARP, ICMP, RST, CLOSING, TLS, fault UI: NOT BUILT.


## Phase 08 · 3D journey stage — COMPLETE (2026-10-26)

### Completed
- `web/src/scene/model.ts`: pure scene model (devices, links + subnets, interface IP/MAC labels, packet shells from frame bytes, TTL n → n−1 at forwards, bit stream while serializing) + `columnLayout` for narrow stages.
- `web/src/JourneyStage3D.tsx` (lazy): R3F Canvas (dpr [1, 2], antialias, ACES filmic, sRGB, demand frame loop, never while hidden or lost), fog, grid, key/rim lights, procedural RoomEnvironment; original host terminals and hex-prism routers, instanced interface ports, CatmullRom tube links with dashed flow, nested shells (app violet, transport sky, internet teal, link amber) that ease in and out (snap under Reduced), instanced bit stream "teaching view"; camera rigs Overview / Follow packet / Inspect layers (exploded shells) with damped OrbitControls; bloom + vignette (off under Reduced or a missed frame budget); hover outline + pointer cursor; canvas aria-label + hidden live step summary; WebGL2 detection, context lost → 2D note, restored → 3D; dev/test hook (`__pj.scene`, `renderInfo`, `screenOf`, `sceneGeometries`, `frames`).
- One selection store (`selection.ts`) shared by 3D clicks, 2D journey nodes (now keyboard buttons), the layer stack and the inspector (new device view with interfaces and routes).

### Commands and results
`npm run verify` exit 0: typecheck 0, lint 0, vitest 194/194, build ok (initial 136.25 kB gzip, lazy 3D 281.26 kB gzip), secrets clean, Playwright 28/28. renderer.info.memory 22 geometries / 2 textures on all five measured resets. Details: `TEST_EVIDENCE.md`.

### Open issues
- Camera moves, packet travel and shell dissolve timing are not cue-driven yet (phase 09); rig changes jump.
- At 390 px the shell label can overlap one interface label at router steps (it sits above on its own scrim).
- Frame-budget fallback logic only unit-reasoned; real devices NOT MEASURED.
- ARP, ICMP, RST, CLOSING, TLS, fault UI, cue builder, GSAP master timeline, playback clock: NOT BUILT.


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

