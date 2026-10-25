# Test Evidence

## Phase 06 — 2026-10-26

Command: `npm run verify` → typecheck 0, lint 0, vitest **168 passed** (7 files; new `routed.test.ts` 15), build ok (initial **129.51 kB gzip** after D-041; 148.23 kB before), secrets clean, Playwright **20 passed**.

`routed.test.ts`: every via-gateway lies in its egress interface's subnet; every device reaches both endpoints and has an ARP entry for the next hop; R1→203.0.113.20 via 198.51.100.2, R2→192.0.2.10 via 198.51.100.1, A/B via their gateways, /30 transit match, no default on routers; UDP request transmitted by A (100 Mb/s), R1 (10 Mb/s), R2 (100 Mb/s); forwards R1 64→63, R2 63→62; frame TTL bytes 64/63/62; per-hop src→dst MACs A→R1.eth0, R1.eth1→R2.eth0, R2.eth1→B; each FCS valid and distinct, IPs 192.0.2.10→203.0.113.20 and ports 50000→7007 identical, IPv4 checksum distinct per hop, transport segment byte-identical and checksum valid; B verifies TTL 62 and never forwards; route:lookup next hops and MACs per device, ARP note contains NOT BUILT; reply transmitted by B, R2, R1 with swapped IPs, "World" delivered; routed TCP: tcp transitions only on A and B, final SND/RCV 1006/5006/5006/1006, 21 transmissions (7 × 3); TTL 1 → `drop:ttl` at R1, no R1 egress, no delivery, no ICMP tag, 1 transmission; TTL 2 → drop at R2; TTL 3 → B sees TTL 1 and delivers; same-LAN TTL 1 delivers with 1 transmission; TTL 0/256 rejected; duplicate-IP / other-subnet / duplicate-MAC each give their own message.

E2E `Routed…`: tags include A/R1/R2 egress, both forwards, B ingress; two deliveries; at hop:R1:egress (hop scope) src MAC 02:00:00:00:01:01 → dst 02:00:00:00:02:00, L2 highlighted, ARP note shown; host scope 192.0.2.10 → 203.0.113.20, TTL 63, arc visible; R2's route table highlights `203.0.113.0/24 directly connected dev eth1`; routed TCP process scope mentions end-to-end; TTL 1 → drop:ttl, no R1 egress/delivery, caption "R1 drops the packet: TTL 1 … ICMP Time Exceeded is NOT BUILT"; TTL 0 inline error.

### Screenshot observations
- `routed-hop-1440.png`: expanded `hop:R1:forward` log row "TTL 64 → 63, IPv4 header checksum 0xA2CB → 0xA3CB … transport checksum are unchanged (the pseudo-header has no TTL); no NAT" (+0x0100 per RFC 1624); `hop:R1:egress` details e14 R1.eth1 64 B / 84 B on L2; inspector active hop "p1 R1→R2 on L2: send 77.22–144.42 µs, arrives 2.144 ms".
- `routed-process-1440.png` (after fix): four nodes A·host 192.0.2.10, R1/R2 "2 interfaces" dimmed, B·host 203.0.113.20; dashed violet arc A→B; link labels "L1 · 100 Mb/s", "L2 · 10 Mb/s", "L3 · 100 Mb/s" under the node row; process panel text with ports and "end-to-end"; TCP cards both ESTABLISHED, four-tuple 192.0.2.10:50000 ↔ 203.0.113.20:7007.

### Repair log (phase 06)
1. Validation tests still used 192.168.1.x defaults; the duplicate-IP case was passing because of the different-subnet rule → switched to RFC 5737 values and added rule-specific message assertions.
2. Persistent-loss bound: replaced the event-count threshold with the structural property (run ends `end:complete`, below `maxEvents`, exactly 3 retransmissions).
3. SVG link labels collided with router nodes in the 4-node layout → labels moved below the node row.
4. A screenshot appeared to show the wrong scope button pressed; a DOM probe showed `aria-pressed` correct and the old button mid 160 ms background transition → test now waits for the transition before capturing (no product change).
5. Bundle 148.23 kB (≈1.8 kB headroom) → zod removed from the web bundle (D-041) → 129.51 kB.

## Phase 05 — 2026-10-26

Command: `npm run verify` → typecheck 0, lint 0, vitest **153 passed** (6 files; new `tcp.test.ts` 14), build ok (initial **146.11 kB gzip**), secrets clean, Playwright **19 passed**.

`tcp.test.ts` (values decoded from the actual segment bytes): SYN {seq 1000, ack 0, SYN}, SYN-ACK {5000, 1001, SYN+ACK}, ACK {1001, 5001}, data {1001, 5001, ACK+PSH, 5 B}, ACK {5001, 1006}, reply {5001, 1006, 5 B}, ACK {1006, 5006}; tcp transitions A: CLOSED→SYN-SENT→ESTABLISHED, B: CLOSED→LISTEN→SYN-RECEIVED→ESTABLISHED, all in `TCP_TRANSITIONS`; final ISS/IRS and SND.NXT/RCV.NXT 1006/5006/5006/1006; every `deliver:app` preceded by ESTABLISHED, client data encap after client ESTABLISHED, first app:send is `app.send.queued`; per encap SND.NXT delta = SYN 1, SYN-ACK 1, data 5, reply 5, ACKs 0; server ACK encap at the deliver timestamp, app:processed exactly 1 ms later and before app:respond; all 7 frames pass FCS residue, IPv4 and TCP pseudo-header checksums and are ≥ 64 B; field map seq 1001 / ack 5001 and log `Sequence number 1001 (0x000003E9)`; `héllo ✓`/`Wörld` → data 10 B, ACK 1011, reply 6 B, ACK 5007; ISNs 4294967295/4294967294 → SYN-ACK ack 0, data seq 0, ACK 5, reply seq 4294967295, final ACK 4; ISNs 1/2 configurable, −1 and 2^32 rejected; lost SYN → retransmit and delivery; lost handshake ACK → B ESTABLISHED immediately followed by deliver:app; wrong port → 4× socket:none, give-up, no delivery; RunController TCP then UDP → CLOSED endpoints, null ISS/SND.NXT, no tcp tags.

E2E `TCP: handshake…`: ISN inputs 1000/5000; first tags LISTEN, app:send, tcp:connect; four-tuple `192.168.1.10:50000 ↔ 192.168.1.20:7007`; at SYN-SENT: A SYN-SENT, B LISTEN, SND.NXT A 1001, no packet marker; log row `TCP header [SYN, ACK] seq 5000 ack 1001`; at the last event both ESTABLISHED, SND/RCV 1006/5006 and 5006/1006; log rows `[ACK] seq 5001 ack 1006` and `[ACK] seq 1006 ack 5006`; server ACK encap before app:processed; Headers seq 1001 / ack 5001; switching to UDP + Run removes TCP cards and tcp tags.

### Screenshot observations
- `tcp-1440.png` (last event, 109/109, t = 1.243 ms): four-tuple line with "teaching ISNs, not secure random ISNs"; A·client and B·server cards both ESTABLISHED with ISS/IRS 1000/5000 and 5000/1000, SND.UNA = SND.NXT 1006 / 5006, RCV.NXT 5006 / 1006; state pills with ESTABLISHED highlighted "A B"; five transitions listed; inspector snapshot #108: 7 frames, 448 frame bytes, 588 byte-times, 10 B delivered.

### Repair log (phase 05)
1. Found before running: ACK of the SYN would clear the queued "Hello" from the send buffer → only data ACKs clear it (D-037).
2. Expected updates to earlier tests: reply text now "World" (5 B); TCP starts with LISTEN/connect instead of `session:start`; the persistent-loss timer list filters to the data packet; its event bound grew from < 80 to < 120 because the 3-way handshake adds ~30 events (retransmission count 3 and give-up still asserted exactly).

## Phase 04 — 2026-10-26

Command: `npm run verify` → typecheck 0, lint 0, vitest **139 passed** (5 files; new `udp.test.ts` 29), build ok (initial **143.81 kB gzip** after D-031; was 150.16 kB), secrets clean, Playwright **18 passed**.

`udp.test.ts`: B receives "Hello", A receives "Hi back", `end:complete`; B's tag sequence for p1 is exactly ingress → verify:link → decap:link → verify:internet → decap:internet → verify:transport → socket:select → decap:transport → deliver:app → app:processed; p1/p2 rx = accepted/processed; reply swaps IPs, ports and MACs; no tags matching syn/ack/retransmit/timer/fin/close/duplicate, no tcp/timer transitions, endpoints stay CLOSED with null SND.NXT; `units.link` equals p1's transmitted bytes, `units.transport` equals the frame's UDP segment, every byte-aligned field ≤32 bits decodes (big-endian; FCS little-endian) to its `raw`, UDP fields at segment bytes 0–2/2–4/4–6/6–8, length 13; encap:transport args include `Source port 50000 (0xC350)`, `Destination port 7007 (0x1B5F)`, `Length 13 (0x000D)`; reply disabled → no app:respond, `app.processed.noreply`; dst port 9999 → socket:none, no deliver/respond, B delivered 0, rx rejected; checksum off → 0 on wire, `verify.transport.udp-none`, still delivered; custom addresses/ports appear in the frame; 16 invalid-input cases each flagged on the right field and `simulate` throws; port 0 and empty reply text flagged; routed checks ports only.

E2E: `UDP slice: Hello delivered…` — no ack/syn/timer tags; verify/socket/processed/respond present; at decap:transport Transport ✓ accepted + Application ◌ pending; deliver:app caption `"Hello" delivered to B echo app`, app card `48 65 6C 6C 6F`; Next → app:processed, Application ✓ processed; second deliver:app `"Hi back" delivered to A client app`; at hop:A:egress link card `02 00 5E A1 00 14 02 00 5E A1 00 0A 08 00`, UDP card starts `C3 50 1B 5F 00 0D`; encap:transport details show `Source port … 50000 (0xC350)`; checksum note cites RFC 768. `UDP slice: wrong port…` — 9999 → socket:none, no deliver/respond, Transport ✕ rejected, caption "No application on UDP port 9999"; reply unchecked → no app:respond; 192.168.1.300 / 01:00:5e:00:00:01 / port 0 → three inline errors, "fix 3 fields", Run disabled; duplicate server IP → "different IPv4", Run disabled. Existing tests updated for the UDP default (TypedConsole total length 33; Headers test switches to TCP first; run lifecycle switches to routed TCP for `hop:R1:forward` and `ack`).

### Screenshot observations
- `udp-journey-1440.png`: SVG A·host 192.168.1.10 —L1 · 100 Mb/s— B·host 192.168.1.20 (B outlined), REQ marker above B; step 16/32 at t = 1.047 ms; caption `app:processed B echo app processes the request (1 ms SIMULATED) and prepares its reply.`; green chips Transport ✓ accepted, Application ✓ processed; APP card `48 65 6C 6C 6F`; inspector snapshot #15: A app sent, B processed, delivered 5 B, 1 frame / 64 B / 84 B-times.
- `udp-invalid-1440.png`: red-bordered client IP with "Each octet must be 0–255.", port 0 with the port-0 explanation, server MAC with the unicast I/G-bit message; "Run blocked: fix 3 fields above."; Run disabled; dirty notice; expanded `socket:select` row shows `Event e12 · B · in · transport · caused by e11`, port 7007, app echo app.

### Repair log (phase 04)
1. Byte-map test read the FCS big-endian; FCS is LE by documented convention → test reads it LE (engine correct).
2. Receiver statuses hidden at `app:processed` (local event) → shown whenever the packet is at the receiver or transport has decided.
3. Initial JS 150.16 kB gzip exceeded the 150 kB target → `"sideEffects": false` on `shared` → 143.81 kB.

## Phase 03 — 2026-10-26

Command: `npm run verify` → typecheck 0, lint 0, vitest **110 passed** (4 files: server 3, engine 28, sim 32, contrast 47), build ok (initial **144.67 kB gzip**, 3D 241.90 kB), secrets clean, Playwright **16 passed**.

Simulation tests (`shared/src/sim/sim.test.ts`): scheduler tie order; determinism and ordering for same-lan/routed × TCP/UDP (identical events + final state on cloned config; non-decreasing ns; equal-time events ordered by tieBreak; ids `e<i>`; causes point backwards; every tag non-empty and every explainKey has a template with all placeholders filled; events deep-frozen); different seed → same tag sequence, different bytes; checkpointed `at(i)` equals forward fold for every index in reverse + random order (5 configs incl. loss); `atTime` includes equal-time events; 0.25×/1×/8× stepping ends on identical final snapshot + metrics; serialization 672 bits / 100 Mb/s = 6.72 µs, arrival = send-end + 0.5 µs; L2 0.0672 ms + 2 ms; onLinkBytes = frameBytes + 20·frames; R1 forwarding TTL 64→63 with valid checksum, same IPs/transport bytes, new MACs and FCS; TCP delivers 5 B and 7 B, buffers empty, timers disarmed, `end:complete`; tag coverage list; UDP has no ack/timer tags; lost response-ACK → 1 drop, 1 RTO fire, 1 retransmit, duplicate discarded, client delivers 7 B once; persistent data loss → 3 retransmits, RTO 200/400/800/1600 ms, give-up, < 80 events; maxEvents 20 → 20 events ending `end:event-cap`; maxDurationMs 1 → `end:max-duration` at 1 ms; no timer fires in a clean run, end < 200 ms; caller mutation after start doesn't change frozen config; RunController stale callback no-op after new run, dirty detection, reset; 257-byte request rejected.

E2E `run lifecycle`: first event `session:start`, routed log includes `hop:R1:forward`, dock shows the event count; Run #1 → Run again → Run #2 with identical log; UDP toggle shows dirty notice without changing the log; Reset restores TCP; same-LAN run has no `hop:R1`; clicking the `ack` row shows "Snapshot after #…" with ESTABLISHED.

### Screenshot observations
- `events-1440.png` (same-LAN TCP): event log rows with layer-coloured left border, time column (µs), tag, explanation; `ack` at 94.44 µs selected — matches hand calculation (20 µs proc + 6.72 µs ser + 0.5 µs prop + 20 µs proc + 20 µs proc + 6.72 + 0.5 + 20). Inspector: "Snapshot after #20 · ack · t = 94.44 µs", A send buffer 0 B, RTO still armed (cancel is event #21), B delivered 5 B, RCV.NXT shown; metrics 2 frames, 128 frame bytes, 168 byte-times occupancy.

### Repair log (phase 03)
1. Routed forwarding test compared bytes including the FCS, which must change → test corrected to compare transport+payload and assert FCS differs (engine was right).
2. StrictMode double-invoked `useState` initializers → two runs on one controller (Run #2 on load). Controller and first run now created in one initializer.
3. Layout tests still asserted the phase-01 "0 µs" dock text; now assert lowercase `ms` units on the real virtual end time.
4. E2E row locator regex didn't match concatenated row text → matched the `.ev-tag` cell exactly.

## Phase 02 — 2026-10-26 (same environment)

Command: `npm run verify` → typecheck 0, lint 0, vitest **78 passed** (server 3, engine 28, contrast 47), build ok (initial **137.58 kB gzip**, 3D 241.90 kB gzip), secrets clean, Playwright **15 passed** (afterEach fails on any GSAP warning or console error).

Acceptance vectors (all in `shared/src/engine.test.ts`):
| Case | Result |
|---|---|
| `Hello` → `48 65 6C 6C 6F` (5 B) | pass |
| `héllo ✓ 😀` = TextEncoder; é `C3 A9`, ✓ `E2 9C 93`, 😀 `F0 9F 98 80` | pass |
| UDP length 13; IPv4 total 33 (UDP), 45 (TCP) for `Hello` | pass |
| Min Ethernet frame 64 B incl. FCS (UDP pad 13, TCP pad 1); 100-byte payload → no pad, 146 B | pass |
| RFC 1071 §3 example → 0x220D; published IPv4 header → 0xB861 | pass |
| Odd lengths (`01` → 0xFEFF, 3-byte, cross-chunk) vs independent reference | pass |
| UDP computed 0 → 0xFFFF (constructed payload); disabled → 0 | pass |
| CRC-32: "" → 0, "123456789" → 0xCBF43926, quick-brown-fox → 0x414FA339; frame residue 0x2144DF1C | pass |
| Bit flips: all 160 single-bit IPv4 header flips rejected; odd-payload flip breaks TCP/UDP checksum; frame flips break FCS | pass |
| Field map tiles every frame bit, unique ids, stable order, non-modelled flags illustrative | pass |

E2E `Headers: selecting a field highlights its exact byte offsets`: IPv4 Total length → bytes [16, 17], value `45 (0x002D)`; Ethernet dst → [0..5]; TCP SYN (1 bit) → [47] with bit range shown; FCS → [60..63]; UDP Length → [38, 39], `13 (0x000D)`; byte grid in viewport. E2E `payload validation`: `héllo ✓` → "10 / 256 bytes · 7 characters", 7 code-point cards incl. `E2 9C 93`; 129×é → "258 / 256 bytes", alert "Nothing was truncated", Encode disabled, input keeps 129 chars.

### Screenshot observations
- `headers-1440.png`: field list grouped Ethernet/IPv4/TCP/Application/trailer with status chips (green "= calc", "⚙ config", "◌ illus."); sticky byte grid 8 per row with decimal offsets, layer-colour underlines, `48 65 6C 6C 6F` at 54–58, pad `00` at 59, FCS `AB 68 FC 08` outlined at 60–63; caption "FCS (CRC-32): bytes 60–63".
- `vp-390.png`: stack Link +19 B · 64 B, Internet +20 · 45, Transport +20 · 25, Application 5; five code-point cards (char, U+, hex, binary); rail shows "5 / 256 bytes · 5 characters". Destination select label was cut ("…via gatewa") → labels shortened.

### Repair log (phase 02)
1. Byte-highlight tint 22% failed AA for app/physical/danger → 12% (measured above).
2. Byte grid scrolled out of view: `.stage{overflow:hidden}` made the stage a scroll container, defeating `sticky` → `overflow: clip`; backdrop capped at 520 px so the mesh doesn't stretch.
3. Duplicate field id `tcp.ack` (ack number vs ACK flag) produced React key errors only visible in the dev log → renamed to `tcp.seqNumber`/`tcp.ackNumber`, added uniqueness test, e2e now fails on console errors (AI-down test allows only its intentional `net::ERR_FAILED`).
4. 390 px select truncation → shorter option labels.

## Phase 01 — 2026-10-25 (Windows 11, Node 24.12.0, headless Chromium via Playwright 1.64.1, SwiftShader WebGL)

Command: `npm run verify`

| Step | Result |
|---|---|
| typecheck (shared, server, web, e2e) | 0 errors |
| lint | 0 problems |
| vitest | 3 files, 43 passed (server 3, fixture 2, contrast 38 incl. 36 AA pairs) |
| build | initial `index-*.js` 384.56 kB / **125.76 kB gzip**; CSS 10.50 kB gzip; lazy `Stage3D-*.js` **241.90 kB gzip** (Vite >500 kB minified warning for the lazy chunk, expected) |
| check:secrets | clean |
| test:e2e | **13 passed** |

E2E cases: shell + badge + body bg `rgb(5, 7, 13)`; lazy 3D mesh (draw calls > 0, lit centre pixel with overlay hidden); View 2D fallback; boot completes exactly once under StrictMode dev and does not replay after reload (`bootCompletions` 1 then 0, `gsapActive()` 0); boot skip by key and by click → final opacity 1 on all HUD panels and badge, wordmark text exact; reduced motion → Reduced pressed, no GSAP children, no boot, 5 console lines in log instantly, grid `animation-name: none`; TypedConsole Enter ×5 → 5 distinct log lines, first contains `2 bytes UTF-8: 48 69`; keyboard Tab reaches Mode group and tabs, Enter on layer row updates inspector, ArrowRight moves tab focus+selection; 1280 drawer opens by keyboard, focus enters, Tab reaches Close, Esc makes it `inert`; layouts 1440×900, 1280×800, 390×844: `scrollWidth − clientWidth = 0`, no control/label overflowing viewport or its own box, every tab inside the tablist, dock shows `0 µs`; AI server down → offline status, app works. Every test asserts no console message matching /gsap/i.

Contrast ratios: see table in `EXPERIENCE.md` (min 4.89 danger on scrim over white).

### Screenshot observations (inspected by eye)
- `vp-1440.png`: three columns + dock fit; HUD single row (wordmark, amber SIMULATED pill, Story/Lab, TCP/UDP, Cinematic/Reduced, 3D/2D, ?); layer stack nested LNK→NET→TRN→APP with coloured left borders and glyphs; Transport selected with glow; inspector shows Transport fields in two columns; console typing mid-line with static caret.
- `vp-1280-drawer.png`: drawer open over the right side with scrim background, Close button focused (sky ring); rail and stage remain visible.
- `vp-390.png` (after fix): single column, stage first; tabs wrap to two rows (Journey/Headers/Delivery scopes, Compare/Practice); no cut-off text; rail, inspector, dock below; dock reads "VIRTUAL TIME 0 µs".
- `stage-with-overlay.png`: 3D icosahedron faintly visible behind the scrimmed panel; text crisp.

### Repair log (phase 01)
1. 390 px: tablist scrolled horizontally, hiding "Compare"; the clip check had excluded `.tabs`. Fixed by wrapping tabs + 2-D underline; removed the exclusion and added an "every tab inside tablist" assertion.
2. Dock label: CSS `uppercase` rendered `µs` as `ΜS` (reads as milliseconds). Units now in `.unit` with `text-transform: none`; e2e asserts `0 µs`.

### Not verified
- Grid drift pause on hidden tab (CSS rule present, not tested).
- WebGL context loss → 2D (handler present, not tested).
- Real-device frame time: NOT MEASURED.

---

## Phase 00 — 2026-10-25

`npm ci && npm run verify` from clean `node_modules`: typecheck 0, lint 0, vitest 3/3, build ok (117.32 kB gzip initial, 241.93 kB gzip 3D), secrets clean, Playwright 6/6. Repair: WebGL pixel probe read cleared buffer → sample Playwright screenshot instead (D-007).
