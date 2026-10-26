# Decisions

## D-001 · Project root (2026-10-25)
The existing empty folder `PacketJourney AI` is the project root; the npm package is named `packetjourney-ai`. No nested folder, to avoid a second level of paths with spaces.

## D-002 · Versions (2026-10-25, from `npm view`)
| Package | Version | Reason |
|---|---|---|
| react / react-dom | 19.3.1 | R3F 9.8.2 peer `>=19 <19.4` |
| @react-three/fiber | 9.8.2 | R3F 9 ↔ React 19 |
| three | 0.186.1 | within R3F `>=0.156`, drei `>=0.159` |
| @react-three/drei | 10.7.9 | peer R3F ^9, React ^19 |
| @react-three/postprocessing | 3.2.2 (+ postprocessing 6.39.5) | peer R3F >=9.7, postprocessing ^6.36 |
| gsap / @gsap/react | 3.15.0 / 2.1.2 | @gsap/react peer gsap ^3.12.5. GSAP is free incl. bonus plugins since 3.13 (Webflow "Standard No Charge" license); re-confirm on gsap.com before release. |
| vite / @vitejs/plugin-react | 8.3.5 / 6.1.2 | plugin peer vite ^8 |
| typescript | **6.0.3** (not 7.0.2 latest) | typescript-eslint 8.72.0 peer `<6.1.0` |
| vitest | 5.0.5 | peer vite ^8 ok |
| @playwright/test | 1.64.1 | |
| express / @types/express | 5.3.0 / 5.0.6 | |
| zod | 4.6.7 | shared schemas |
| eslint / typescript-eslint / react-hooks | 10.13.0 / 8.72.0 / 7.1.1 | |
| @fontsource space-grotesk / jetbrains-mono | 5.3.0 | bundled fonts, no CDN |
| tsx | 4.23.15 | runs server TS directly |
Exact versions pinned; lockfile committed.

## D-003 · Shared package as TS source
`@packetjourney/shared` exports `src/index.ts` directly (Vite and tsx both consume TS). No build step for shared/server; `npm run build` builds web only. Revisit if server ever needs to ship compiled.

## D-004 · Server security
Binds `127.0.0.1` only. Requests without `Origin` (same-origin via Vite proxy) are allowed; cross-origin requests must come from `127.0.0.1:5173` or `:4173`, else 403. AI config (`AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`) read server-side only; Vite `envPrefix` is `VITE_`, so AI_* cannot reach the bundle; `scripts/check-no-secrets.mjs` scans src and dist. No model name in code.

## D-005 · No CORS / dotenv dependency
CORS is 8 lines of middleware; `.env` loaded with Node's built-in `process.loadEnvFile`.

## D-006 · Smoke observability
`window.__pj` exposes `stageReady`, `drawCalls`, `gsapReverts`, `contextLost` for Playwright. It holds no engine state.

## D-007 · 3D pixel verification
WebGL canvases are read from Playwright's composited screenshot, not via `drawImage` on the canvas, because without `preserveDrawingBuffer` (deliberately off for performance) the buffer is cleared after compositing.

## D-009 · Tokens in TS, injected into CSS (phase 01)
`web/src/tokens.ts` is the only place colours/durations/eases are defined; `applyTokens()` writes them as CSS custom properties at startup. Lets GSAP, CSS and the contrast test share one source with no build plugin.

## D-010 · ScrambleText from GSAP, registered once
`gsap/ScrambleTextPlugin` (bundled with gsap 3.15, free under the GSAP standard license since 3.13 — re-confirm on gsap.com before release) registered in `web/src/gsap.ts`. No custom scramble.

## D-011 · Boot guard
Play decision taken once in `useState`; sessionStorage written only on completion. Avoids StrictMode double-play without module-level flags. Boot animates the real shell (`.hud-enter`), not a separate overlay, so skipping lands on the true final layout.

## D-012 · Phase-00 GSAP smoke tween removed
It was a perpetual (repeat −1) tween, which phase 01 forbids. Revert-on-unmount is now covered by the boot timeline + `gsapActive()` check.

## D-013 · Stage preview fixture
`web/src/fixture.ts` computes a typed layer-stack preview (UTF-8 via TextEncoder; header sizes as protocol constants; Ethernet 46-byte min payload padding). Marked `ponytail:` — replaced by engine snapshots in the engine phase. The 3D smoke mesh stays as the stage backdrop behind a scrim.

## D-014 · Tabs wrap instead of scrolling
On narrow screens the tablist wraps; underline tracks x and y. Horizontal tab scrolling hid "Compare"/"Practice" at 390 px.

## D-015 · Engine lives in `shared/` (phase 02)
Pure TS, no DOM; web and (later) server import the same code. `web/src/fixture.ts` deleted; all stage numbers now come from the reduced snapshot.

## D-016 · One spec list per header
Bytes and the field map are produced from the same `Spec[]`, packed MSB-first. Checksums: build with 0, compute, rebuild. Avoids a second offset table.

## D-017 · FCS shown both ways
CRC value + wire octets LSB-first, verified by the 0x2144DF1C residue. Bit-order on the medium (LSB-first per octet, FCS x³¹ first) belongs to the physical teaching view, NOT BUILT.

## D-018 · Seeded values
seq, ack, IP ID and source port from mulberry32 (seed 42 in the UI). Simplification of RFC 9293 ISN selection / RFC 6528; documented in field `source`.

## D-019 · Loopback scope disabled
Loopback produces no Ethernet frame; showing one would be wrong. Option is visible but disabled (NOT BUILT) until the delivery-scopes phase.

## D-020 · Field ids unique, console errors fail e2e
`tcp.seqNumber` / `tcp.ackNumber` vs flags `tcp.ack`… after a duplicate-id bug; e2e afterEach now fails on any console error.

## D-021 · Integer-nanosecond virtual time (phase 03)
Scheduler keys are integer ns; `virtualTimeMs` is derived. Avoids float accumulation affecting order/equality. Serialization rounds up to whole ns.

## D-022 · Effects inside events
Each event carries its state `effects`; `reduce` applies them, and the simulator uses the same reducer for its working state. Replay is therefore exact by construction; the test compares checkpointed seeks against step-by-step folding.

## D-023 · Live-check on scheduled items
Cancelled timers are skipped at pop time (generation mismatch) so they never advance time, emit events, or trip `maxDuration` after the exchange finishes.

## D-024 · Assumed ESTABLISHED sessions
Handshake/close belong to a later phase; the `session:start` event states the assumption. Seq/ack derive from seeded ISNs (+1 for the assumed SYN).

## D-025 · Loss fault implemented early, UI deferred
Needed to prove bounded lost-ACK retries this phase. Only `loss` by packet kind; no fault controls in the UI yet.

## D-026 · Draft vs running config
HUD protocol, destination, message and UDP checksum edit a draft. The stage always shows the frozen running config; a "Draft differs" notice offers Run or Reset. RunController + its first run are created in one `useState` initializer (StrictMode double-invocation otherwise started two runs).

## D-027 · Default run is UDP same-LAN (phase 04)
The first complete slice is UDP; TCP and Routed stay selectable. Echo app listens on 7007 (not 7, to avoid implying RFC 862 Echo).

## D-028 · Explicit verify events at the receiver
Link, IPv4 and transport checks are separate events computed from the real bytes, so later phases (faults, bit flips) and cues can find them by tag. Transport acceptance (`decap:transport`) and application processing (`app:processed`) are separate states on each packet (`rx`).

## D-029 · Socket table, no ICMP
Ports demux strictly; unbound port → `socket:none`. ICMP Port Unreachable / TCP RST are named in the explanation and marked NOT BUILT.

## D-030 · Same-LAN addresses editable, Routed fixed
Routing lookup is NOT BUILT, so Routed keeps fixture addresses; switching template resets addresses (ports kept).

## D-031 · `shared` marked side-effect free
After this phase initial JS hit 150.16 kB gzip (> 150 target); `"sideEffects": false` let Rollup drop unused zod schemas → 143.81 kB. zod stays for the `/api/health` contract.

## D-032 · 2D journey = permanent fallback
`Journey2D` renders only from events + snapshots (topology, packet marker, step controls, caption, receiver statuses, nested layer cards with actual bytes). It is always in the DOM in this phase; later phases must keep it at feature parity with the 3D stage.

## D-033 · Teaching ISNs replace seeded ISNs (phase 05)
`cfg.tcp.isnClient/isnServer` default 1000/5000 per the spec fixture; validated as u32. Supersedes D-024 (assumed ESTABLISHED) and D-018's seeded seq/ack for the simulator (the standalone encoder still uses the PRNG when no seq/ack is given).

## D-034 · App writes are queued until ESTABLISHED
`app:send` at t = 0 puts bytes in the send buffer (`app.send.queued`); `flush` segments them once ESTABLISHED and nothing is outstanding. This gives "no delivery before ESTABLISHED" by construction and keeps sequence numbers byte-based.

## D-035 · Single transition table
`TCP_TRANSITIONS` is used by the engine (`checkTransition` throws on illegal moves) and rendered by `TcpCards`, so diagram and engine cannot disagree.

## D-036 · Default reply text "World"
Matches the TCP fixture (5 B, client's final ACK 5006); applies to UDP too.

## D-037 · ACK of SYN keeps queued data
`processAck` only clears the send buffer when data (not the SYN) is acknowledged — caught while implementing: clearing it on the SYN-ACK would have dropped "Hello" before sending.

## D-038 · Real route lookup replaces the fixed path (phase 06)
`lookup()` (longest prefix) + `arpCaches()` decide every hop; `template.path` is only drawing order. Supersedes D-030's "routing NOT BUILT". Routed addresses remain a fixed fixture (no topology editor); ports and TTL are editable.

## D-039 · RFC 5737 addresses everywhere
Same-LAN default moved from 192.168.1.x to 192.0.2.x so all demo addresses are documentation blocks.

## D-040 · Dedicated `drop:ttl` and `route:lookup` tags
Cue building (later) can find TTL expiry and routing decisions without parsing text.

## D-041 · zod removed from the web bundle
At 148.23 kB gzip after this phase, the web health check now does a structural check (server keeps zod validation) and payload constants moved to `bytes.ts` → 129.51 kB. Supersedes the "zod stays" note in D-031.

## D-042 · Default scope Hop ↔ hop
The phase's new teaching content is per-hop addressing; the selector is local to the journey view.

## D-008 · Postprocessing / drei installed, not yet imported
Installed and version-checked for later phases; not imported in phase 00 so they do not inflate the 3D chunk.

## D-043 · Normal close only; close is opt-in for raw mode (2026-10-26)
Modelled: ESTABLISHED → FIN-WAIT-1 → FIN-WAIT-2 → TIME-WAIT → CLOSED (client) and ESTABLISHED → CLOSE-WAIT → LAST-ACK → CLOSED (server), with separate ACK and FIN from the server (its app closes after its 1 ms SIMULATED delay). FIN consumes one sequence number and is retransmitted by RTO. A FIN+ACK in FIN-WAIT-1 that acknowledges our FIN is processed as ACK → FIN-WAIT-2, then FIN → TIME-WAIT. Retransmitted FINs are re-ACKed; in TIME-WAIT the timer restarts (RFC 9293 §3.10.7.4). Simultaneous close (CLOSING) and RST: NOT BUILT. `close.enabled` defaults to false so earlier raw fixtures still end ESTABLISHED; the UI checkbox enables it, HTTP mode forces it.

## D-044 · TIME-WAIT is an educational timer
Default 400 ms of virtual time, configurable 1–2000 ms, labelled EDUCATIONAL everywhere. Real stacks wait 2×MSL (RFC 9293 suggests MSL = 2 min); that would dwarf every other event.

## D-045 · The client closes after it processes the reply
Close is triggered by the client app once its data is ACKed and (if a reply is expected) the reply has been processed. An empty raw message with close on is the orderly no-data close: handshake → FIN exchange, no data segment. Empty is rejected otherwise.

## D-046 · HTTP session demo = two separate simulations
`simulateHttpSession(base, cookieB)` runs connection A (`GET /`, no cookie → server issues `Set-Cookie: sid=demo-xxxxxxxx`) to completion including TIME-WAIT, then connection B (`GET /profile`, client port + 1, ISNs + 1000, seed + 1) whose server starts with A's in-memory session table. Each connection keeps its own virtual clock; the UI switches A/B. Ids are deterministic from the seed (`demo-` + 8 hex), never random or secret. The server app answers 200 OK with a UTF-8 body containing an em dash so Content-Length (bytes) differs from the character count. Missing or unknown cookie → unrecognized + new id. No session-layer header; no browser cookies; HTTP is plain text; TLS NOT BUILT. UDP: HTTP mode is rejected by validation and the UI option is disabled with the reason; switching to UDP resets the mode to raw.

## D-047 · 3D renders a pure scene model (2026-10-26)
`web/src/scene/model.ts` derives devices, links (subnet labels), interface labels and packet shells from the run + current step (frame bytes and event args only). `JourneyStage3D` renders that model and nothing else; shells use the same depth table as the 2D layer cards (moved there from `Journey2D`). Unit-tested against the fixtures.

## D-048 · The 3D viewport lives in the Journey tab
The old full-stage background canvas sat under opaque panels. The stage is now a 440 px viewport (560 px on ≤768 px screens) at the top of the Journey tab; the 2D SVG journey, step controls, captions and inspector stay below it as the keyboard path. When WebGL2 is missing, View = 2D or the context is lost, a "2D view · reason" note replaces the canvas and the same 2D journey remains.

## D-049 · Labels are projected DOM, not drei `Html`
drei `Html` creates extra React roots; under StrictMode it logged "synchronously unmount a root" errors and dropped labels. Labels are now plain DOM in the main tree, positioned each rendered frame by projecting 3D anchors (no React state per frame). They stay crisp, selectable by tests and legible at 390 px.

## D-050 · Narrow stages use a column layout
Below 560 px stage width the same scene is laid out top→bottom (`columnLayout`): device/link labels on the left, interface IP/MAC on the right. Entities, labels and shells are identical (unit-tested).

## D-051 · Leaks and context loss found during verification
- `hasWebGL()` created a WebGL context on every App render; after ~16 the browser dropped the live stage's context. Now probed once per page.
- drei `Outlines` builds its geometry imperatively and never disposes it on unmount; outlines are now always mounted and toggled by `visible`.
- drei `Instances` for the bit stream leaked one geometry per mount; replaced by one permanently mounted `instancedMesh` that is hidden or updated.
- Static scene parts (environment, effects) are memoised components.
Result: renderer.info.memory constant across five resets (TEST_EVIDENCE).

## D-052 · Procedural environment and grid without drei loaders
drei `Environment` and `Grid` pushed the lazy chunk over its 300 KB gzip budget (300.95 KB), mostly from HDR/EXR loaders never used here. Replaced with three's procedural `RoomEnvironment` through PMREM (no files, disposed on unmount) and `GridHelper` faded by scene fog → 281 KB.

## D-053 · Camera rigs jump; frame loop on demand
Overview / Follow packet / Inspect layers place the camera instantly (cue-driven moves are phase 09; Reduced never animates the camera). OrbitControls have damping and distance limits and work while paused. `frameloop` is `demand` while paused, `always` only while playing (playback NOT BUILT, so always demand) and `never` when the tab is hidden or the context is lost. Bloom + vignette are off under Reduced motion and after 30 missed frame budgets. Playwright runs with one worker because every page renders SwiftShader WebGL on the CPU.

## D-054 · Presentation time vs virtual time (2026-10-26)
The clock owns presentation time (PT, seconds at 1×). `buildCues` gives every event a PT slot by cue kind (typeOn 0.6 s, wrap 0.5, unwrap 0.45, transmit 1.2, hop 0.5, ack 0.4, drop 0.8, retransmit 0.6, state 0.3). Virtual time is derived: transmit cues map PT linearly onto send start → arrival (exact engine timing); every other cue is a zero-VT **teaching hold**, shown as "teaching hold · presentation only" in the dock and never counted in metrics. The master timeline's duration is the last cue's end (an end marker is added).

## D-055 · One clock, paused master, refs for 3D
`PlaybackClock` runs one rAF loop (idempotent start, so StrictMode cannot double it; frame delta clamped at 250 ms). Each change calls `master.time(pt)`; the master is created `paused` and never played. Components add child timelines at 0 (`useMasterChild`, useGSAP-scoped, removed and reverted on rebuild/unmount). React state changes only when the event index changes; the timestamp, hold label and scrubber are written to the DOM per tick; the 3D stage reads `{index, progress, vt}` from a ref in `useFrame` and requests a frame on every clock change.

## D-056 · Determinism rules for choreography
- 3D shell scale/opacity, TTL flash, packet path and bit flow are pure functions of (snapshot model, cue progress).
- GSAP `set` on `textContent` is not scrub-safe (reverting a set blends the two strings' numbers and text), and ScrambleText uses random characters. The decoder/flyer overlay is therefore one GSAP tween over the whole span whose `onUpdate` renders text as a pure function of timeline time, with a deterministic hex scramble.
- Ladder arrows use numeric stroke-dashoffset tweens (initial offset = length in markup).

## D-057 · Playback defaults and controls
After every Run the clock sits paused at the end (full result visible, as before playback existed). Play from the end restarts at 0. Stepping (log rows, journey buttons, ←/→) lands at the end of the event's cue, so its state is fully shown. Shortcuts: Space/K play-pause, ←/→ or ,/. previous/next event, Home reset, all ignored inside inputs, selects, textareas, tab lists, open dialogs, and Space on focused buttons. A hidden tab pauses with "Paused: tab was hidden". One polite live region (App announcer) speaks per event; the journey caption and stage summary are no longer live.

## D-058 · Camera and Reduced motion
Follow rig: eased (power2.inOut) 0.6–1.2 s dolly on cue changes, held while a typeOn or wrap cue is showing text. Overview/Inspect jump. Reduced motion: cue progress is treated as 1 (shells switch instantly), no scramble or flyer, no camera moves, no bloom pulse; playback and stepping still work. Typing of the payload text: NOT BUILT (typeOn cues show the app write via the decoder/labels instantly).
