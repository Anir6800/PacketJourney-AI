# Test Evidence

## Phase 13 — 2026-10-26

Command: `npm run verify` (exit 0) → typecheck 0, lint 0, vitest **239 passed** (17 files; new `server/src/explain.test.ts` 6, `web/src/tutor/tutor.test.ts` 5), build ok (initial entry 143.34 kB + shared chunks 5.61 kB ≈ **148.95 kB gzip**; TutorPanel lazy 3.37 kB; no zod, key or provider URL in any web chunk), `check-no-secrets` clean (now also `nvapi-` shapes and the literal configured key; probe file with the real key value was detected and removed), Playwright **50 passed** (new `e2e/tutor.spec.ts` 3).

`explain.test.ts` (mock provider, no network): success → 200, `live-ai`, `verified`, refs kept, key sent only as `Authorization: Bearer` to `{AI_BASE_URL}/chat/completions`, never in the response; malformed outputs (prose, wrong types, truncated JSON) → 502 `malformed`; invalid refs dropped and invented numbers (0xbeef, 12.5) → `generated` with caveats; timeout → 504, upstream 429 → 429, network rejection → 502, upstream 500 → 502; injection question travels inside the JSON facts (system prompt unchanged, marks it untrusted), response limited to the five allowed keys, model HTML returned verbatim as text; bounds: bad kind 400, 301-char question 400, 20 kB body 413, 4th request in the window 429, no provider 503, foreign origin 403.
`tutor.test.ts`: bounded request from the current step (SYN forward → A SYN-SENT); built-in field/why/layer/compare answers labelled built-in with supplied refs ("TTL = 64", "Because of route:lookup at R1", "new frame", "three-way handshake"); stale race: a slow first answer resolving after the second is never applied; 504/429/network become statuses; only `/api/explain` is ever requested.
E2E `tutor.spec.ts` (`/api/health` and `/api/explain` mocked): no provider → live checkbox disabled, consent text says explanations stay local, Explain layer / TCP vs UDP / Why did this happen all answer "Built-in explanation", the TTL field pulses once, zero requests to /api/explain; provider configured → nothing sent until the box is ticked; ticked → request carries kind/layer/question as data, answer labelled "Live AI · grounded…", page never navigates; HTML in an answer renders as text (no img, no script effect); 504 → "Live AI timed out (HTTP 504); showing the built-in explanation." with the Internet layer still selected; stale race in the browser: the late first answer never replaces the second.

### Live AI (manual, real credentials)
One request via the real server (`npx tsx server/src/index.ts`, `.env` with the NVIDIA endpoint and model) for a synthetic TTL field/event snapshot: HTTP 200 after 57 s; `source: live-ai`, `grounding: verified`, refs `["ipv4.ttl","e12"]`, explanation restricted to the supplied R1 forward facts with the caveat "Only R1's forwarding event is shown". Consequence: default upstream timeout raised from 20 s to 60 s. The browser UI against the real provider was not exercised; typical latency NOT MEASURED.

### Repair log (phase 13)
1. Rate limiter ran after body parsing, so oversized requests were not counted → limiter moved before parsing.
2. First `hop:R1:forward` is the SYN; test expectation (ESTABLISHED) corrected to SYN-SENT (engine right).
3. Built-in layer answers listed Version/IHL/DSCP first → key-field list per layer.
4. 57 s live latency vs 20 s default timeout → 60 s default.
5. Lint: Express error handler's required 4th parameter → commented disable.
## Phase 12 — 2026-10-26

Command: `npm run verify` → typecheck 0, lint 0, vitest **228 passed** (15 files; new `shared/src/sim/compare.test.ts` 5, `web/src/practice/practice.test.ts` 1), build ok (initial entry 143.18 kB + shared chunks ≈ 5.6 kB ≈ 148.8 kB gzip; Compare 2.79 kB and Practice 3.49 kB lazy), secrets clean, Playwright **45/47** in the full run: `faults.spec` "handshake cannot be targeted…" and `motion.spec` "master timeline duration…" timed out under load (30 s); both, and the rest of those two specs (11/11), passed on an immediate rerun. New `e2e/compare.spec.ts` 3/3.

`compare.test.ts`: TCP and UDP configs identical except the protocol; one fault event each, on the first data packet (attempt 0, hop 1), at different event indexes (semantic matching); metrics recomputed independently (frame bytes = sum of transmitted frame lengths, preamble/IFG excluded; 10 unique bytes; first delivery, completion, goodput, overhead ratio); full − delivery frame bytes = handshake + pure ACK frame bytes; lost ACK → 1 retransmission + duplicate, unique bytes stay 5; UDP data drop → 0 bytes, 0 retransmissions, no delivery times, goodput n/a, 1 drop; TCP → 10 B, 1 retransmission.
`practice.test.ts`: 12 unique questions; answers from engine fixtures (02:00:00:00:02:00, 62, no, 7007, 1006, 1001, 3, 0, 0, 1, FIN-WAIT-1, yes); deterministic; grading normalizes MAC separators, case, y/n; "62.0" and empty rejected.
E2E `compare.spec.ts`: routed Hello: 10 B both; full TCP frame bytes > delivery-only; delivery-only TCP = UDP frame bytes; drop first data → TCP 10 B with 1 retransmission, UDP 0 B (request lost, so no reply), 0 retransmissions, 1 drop each; every cell's text equals its exact engine value after switching; UDP first delivery and goodput n/a; stepping the TCP cursor leaves UDP unchanged; no winner claim. Reduced: exact value immediately. Practice: 12 questions, no reveals and the MAC answer absent before submit; correct MAC → ✓ with evidence; TTL 64 → ✕ "answer 62"; score 2/12 · 1 correct; persists over reload; Reset → 0/12, no reveals, localStorage key removed.

### Screenshot observations (Playwright, inspected)
- `compare-1440.png`: first capture after switching to "Drop first data" showed stale UDP cells (10 B, first delivery 2.222 ms, completion 0.027 ms) → root cause: CountUp wrote textContent while React also rendered the text child (React then updated a detached node) → span now has no React child; all-cells exactness check added.
- `practice-1440.png`: 12 cards; Q5 after submitting 1006 shows "✓ Correct · you answered 1006 · answer 1006", explanation, evidence rows request seq 1001 / data bytes 5 / server ACK 1006; other answers not shown.

### Repair log (phase 12)
1. Name clash `Metrics` (state.ts) → `CompareMetrics`.
2. Test expected UDP 5 B after a request drop; the engine correctly delivers 0 B (no request → no reply) → expectation fixed.
3. Stale count-up text (see screenshot) → effect-owned span text.
4. AI badge test now follows `/api/health` (a local `.env` with AI settings was added; see STATUS).
## Phase 11 — 2026-10-26

Command: `npm run verify` (exit 0) → typecheck 0, lint 0, vitest **222 passed** (13 files; new `shared/src/sim/faults.test.ts` 11, `web/src/faults/chain.test.ts` 1), build ok (initial entry 143.67 kB + shared chunks 5.36 kB = **149.03 kB gzip**; lazy: 3D 282.89, ConfigForm 3.17, FaultEditor 1.85, HeaderView 1.40, SessionPanel 1.23), secrets clean, Playwright **44 passed** (new `e2e/faults.spec.ts` 4).

`faults.test.ts` (routed unless noted): dropped data attempt 0 on hop 1 → `fault:drop`, `drop:fault` at R2, timer fire, retransmission with byte-identical frame, B delivers once, deliveredBytes 10, appBytesSent 15; lost ACK with reply disabled → retransmit, `tcp:duplicate`, re-ACK from B, one delivery (5 B); lost response-ack → one server retransmit, client delivers once; drops on attempts 0–3 → 3 retransmissions, give-up, app failed, no delivery, identical events on re-run, RTO sets 200 (SYN), 200/400/800/1600 (data); UDP drop → no timers, no retransmit, 0 delivered, 5 B sent; UDP delay 5 ms on hop 2 → delivery exactly 5 ms later, no drop tags; TCP data delayed 300 ms (> RTO) → retransmission, late original discarded as duplicate, one delivery, deterministic; UDP wire corruption → `drop:link` "FCS mismatch" at R1 with no IPv4/transport checks there, nothing at B, packet marked corrupt; TCP transport corruption with recomputed FCS → forwarded by R1 and R2, B passes link and IPv4 checks, rejects "TCP checksum mismatch", clean retransmission delivered once; SYN/SYN-ACK/handshake ACK/FIN/final-ACK targets rejected ("after the connection is established") and `simulate` throws; UDP ACK target rejected; hop 3 rejected ("Hop must be 0–2"); offset 25 rejected ("25-byte"); delay 0 rejected; unmatched fault (attempt 2) leaves the event list unchanged.

E2E `faults.spec.ts`: Lab UI adds "drop data · attempt 0 · hop 1" (routed TCP) → chain "FAULT · drop (data, hop 1) → dropped before R2 → A timer expires → A retransmits → B delivers once"; at `drop:fault` the scene notice is R2 "DROPPED · simulated", fracture mounted and visible, 3D tag and 2D SVG tag shown, A's RTO ring lit in 3D and visible in 2D; same in View 2D; chain chip jumps to the retransmission. UDP same-LAN wire corruption → "BIT FLIP · simulated", one pink byte, `drop:link` caption "FCS mismatch", chain "FCS fails at B"; routed TCP transport corruption → chain "transport checksum fails at B", caption "TCP checksum mismatch". Packet options are exactly data/ack/response/response-ack; lost ACK (reply off) → chain "B discards duplicate, re-ACKs", under Reduced the notice at B "DUPLICATE · discarded, re-ACKed" in 3D and 2D, effects off, one delivery. UDP: no "Lose a TCP ACK"; delay 5 ms → "DELAYED 5 ms · simulated", two deliveries, no drop tags.

### Screenshot observations (Playwright, inspected)
- `fault-drop-1440.png` (routed TCP, mid `drop:fault` cue): red shards around the capsule above R2 with "DROPPED · simulated"; amber RTO dot rings around A and B with "RTO 200 ms · deadline 204.443… ms · simplified policy"; cause chain chips under the stage with "dropped before R2" outlined as current; 2D: "DROPPED · simulated" above R2, rings with "RTO 197.788 ms left"/"RTO 195.567 ms left"; ladder showed the retransmission as "none seq ? ack ?" → fixed (labels from the original packet, "· retransmission").
- `fault-corrupt-1440.png` (routed TCP, `drop:link` at R1): TCP header bytes "… 00 00 03 E9 [01] 00 13 89 …" with the flipped byte pink; ladder ✕ at mid-link for the lost attempt; inspector Drops 1.

### Repair log (phase 11)
1. Retry-exhaustion test expected four timer sets; the engine correctly arms a fifth (1600 ms) whose expiry triggers give-up → expectation corrected (behaviour unchanged).
2. `fault:*` events had no layer depth, so the byte grid (and pink byte) did not render at the corruption event → link depth for `fault:` tags.
3. Initial bundle 153.13 kB > 150 → Lab-only UI, Headers view and session panel moved to lazy chunks (149.03 kB).
4. Ladder retransmission label read "none seq ? ack ?" → header values from the original packet.

## Phase 10 — 2026-10-26

Command: `npm run verify` (exit 0) → typecheck 0, lint 0, vitest **210 passed** (11 files; new `web/src/story/story.test.ts` 9), build ok (initial **149.19 kB gzip** — 0.8 kB under the 150 kB budget; lazy 3D 282.12 kB), secrets clean, Playwright **40 passed** (new `e2e/story.spec.ts` 5; 1 worker, own port 5179).

`story.test.ts`: no digits in any of the 67 templates outside placeholders (allowing IPv4/UTF-8/0x) and every key listed in `docs/STORY_SCRIPT.md`; every caption = its template filled with its values (5 fixtures); encapsulation layers app → transport → internet → link → physical and decapsulation link → internet → transport → app for same-LAN/routed × TCP/UDP and HTTP; chapters ordered; UDP journey has no state/ACK beats, TCP has SYN-SENT/SYN-RECEIVED/ESTABLISHED before the request send; routed TCP values re-derived from the A→R1 frame bytes (ports, seq 1001, ack 5001, TCP checksum, header 20, IPs, TTL 64, IPv4 checksum, total length, MACs, EtherType 0800, FCS, frame length), router hops R1 64→63 and R2 63→62, recap TTL chain from the transmitted frames, delivery "Hello" 5 B at B, first four sends SYN 1000/0, SYN-ACK 5000/1001, handshake ACK 1001/5001, request 1001/5001; fault stories show drop + retransmit (TCP) or drop + missing delivery (UDP); predictions: routed TTL 1 stops "At R1", one byte longer → ACK 1007, same-LAN UDP "still arrives at B" and "0" ACKs; routed TCP estimate between 120 and 240 s; question validation (empty, 300-byte, port 0, equal ports) and HTTP question TCP-only.

E2E `story.spec.ts`: fresh session → Story pressed, exactly one question (message), typed prompt; empty message → "Enter at least 1 byte", stays; "héllo" → "6 / 256 bytes UTF-8 · 5 characters"; transport cards' contrasts; port 0 → "Ports 1–65535", stays; Back ×2 keeps "héllo". Routed TCP story walked beat by beat (all ~33): each rendered caption equals the engine-built beat (`__pj.story`), key-fields panel shown on layer beats, encapsulation and decapsulation layer orders as above, ESTABLISHED state and ACK beats present; Restart → question 1; Space completes typing then advances, ← back, Skip chapter → Journey, rail marks Journey current. UDP story: no state/ACK beats. Reduced motion: prompt and captions complete immediately. Lab mid-story: message "Ping!", routed, TCP kept, same journey step, no dirty draft; Replay as story → encapsulation; reload resumes the same beat.

### Screenshot observations (Playwright, inspected)
- `story-beat-1440.png`: rail Encapsulation 1/5 · Journey 0/19 · Decapsulation 0/4 · Recap 0/5 (first version overlapped labels → 2×2 grid fix); caption "Application · your message / Your message "Hello" is 5 bytes of UTF-8. / Its first byte is 0x48, which travels as the bits 01001000."; camera Inspect layers; inspector "KEY FIELDS · THIS BEAT — Application data 5 bytes UTF-8".
- `story-recap-1440.png`: rail Encapsulation 5/5, Journey 19/19, Decapsulation 4/4, Recap 1/5; "Recap · process to process" typing; 2D overlay switched to Process ↔ process with the A↔B arc; decoder "B ✓ port 7007 → echo app".
- `story-q-390.png`: first version placed the question below stage and event log → story rail now leads on phones; after fix the question sits directly under the header with input, byte count and Back/Next.

### Repair log (phase 10)
1. A template hard-coded "TTL of 1" / "reach 0" → TTL probe is a filled placeholder; wording without numbers.
2. Test helper raced typing (clicking Next after typing finished submitted the question) → helpers click the console, which only completes typing.
3. Space did not advance: the window key handler saw a stale "typed" → ref mirror set in onDone, handlers refreshed in a layout effect.
4. Console click completes one line → helpers click until `data-done`.
5. Boot intro stretched to ~4–10 s under load (failed its 4 s check): the 3D chunk now mounts after the intro, and `gsap.ticker.lagSmoothing(0)` keeps time-boxed motion on wall time (intro measured 2.28 s despite a 1.5 s main-thread stall).
6. Raw wall-clock rate check failed under load (0.33) → exact check: wall time consumed by the loop ≤ elapsed, PT = consumed.
7. A full run failed 40/40 with `ERR_NO_BUFFER_SPACE`: Playwright had reused another local project's Vite server on 5173 → e2e now starts its own server on 5179 (`reuseExistingServer: false`).
8. Story beats were built on every run (two extra engine runs for predictions) → only while a story plays.

## Phase 09 — 2026-10-26

Command: `npm run verify` (exit 0) → typecheck 0, lint 0, vitest **201 passed** (10 files; new `web/src/motion/motion.test.ts` 7), build ok (initial **140.87 kB gzip**, lazy 3D **282.09 kB gzip**), secrets clean, Playwright **35 passed** (new `e2e/motion.spec.ts` 7).

`motion.test.ts` (routed TCP + close fixture): one cue per event, contiguous PT, each slot = its kind's duration, span = sum; kinds typeOn/wrap/unwrap/transmit/hop/ack/state from tags; transmit cues span exact send start → arrival, every other cue is a zero-VT hold; `locate` mid-transmit → progress 0.5 and VT at the exact midpoint; ladder spans start at first transmit and end at the peer. Clock with a fake 16 ms frame source: 2× reaches the end in half the frames of 1×; PT → (event, VT) independent of speed; play from end restarts at 0; repeated play keeps one scheduled frame; 250 ms frame clamp; pause freezes PT; loops 0 after pause/end.

E2E `motion.spec.ts`:
- Master duration = mapped span = clock duration; starts paused at the end; masterTime = span; 0 loops, 0 active tweens; routed TCP span larger.
- 1.5 s of play at 1×: PT per wall second between 0.4 and 1.15 (one loop; a duplicate StrictMode loop would give ≈2); loops 1. Pause → after 700 ms, PT, masterTime, packet world position, shells, timestamp, ladder offsets and captions unchanged; masterTime = PT.
- Speed: PT per wall second consumed by the real rAF loop **1.000000 at 1×, 2.000000 at 2×**; playing to the end at 2× gives the same end state and dock text (virtual end, events) as before playing; 4 sampled PTs identical after 2× play.
- Scrub: 12 PTs across the routed TCP run captured forward (seek), then reproduced by the scrub range input backward: event index, VT, committed scene step, present shells, shell scale/opacity/visibility, packet position, labels, decoder text, TCP states, SND/RCV.NXT, ladder dashoffsets, timestamp and caption all equal. Mid-wrap link shell scale > 0.34 (1.15 → 1 in progress).
- Reset (Rewind to start) after play: PT 0, paused, loops 0, active tweens 0; new Run while playing → paused at end, loops 0, active tweens 0.
- Reduced: mid-wrap link shell at final scale 0.34 / opacity 0.22, decoder already shows `FCS xx xx xx xx`, effects off, Follow rig + ArrowRight still steps.
- Hidden tab → paused + "Paused: tab was hidden"; Space toggles play on the page, types a space in the message field; ArrowLeft in the field leaves PT unchanged; Home → PT 0; ArrowRight → event 1; exactly one polite live region besides the console log; announcer "Step 2: …".

### Browser observations (Claude in Chrome, dev server)
- Default page: master duration 15.5 s = span; 1 s of play advanced PT by 0.92 s (no double speed); pause froze PT and master time together.
- Routed TCP paused mid hop:R1:egress (progress 0.58, VT 1.283 ms): packet between R1 and R2 on L2 with magenta bit particles and "bit stream · teaching view"; shell list Link 02:00:00:00:01:01 → 02:00:00:00:02:00, Internet TTL 63, Transport seq 1000, Application 0 B; decoder "R1 · Ethernet header + FCS · 64 B" (value then empty → fixed: FCS from frame bytes); dock teaching-hold label / timestamp.
- First determinism probe found 1/12 mismatch with garbled decoder text "CRC0 residue 0x0DF0C ✓" → see repair 2; after repairs 12/12 identical.

### Repair log (phase 09)
1. ScrambleText (random chars, records original text at first render) not scrub-safe → deterministic scramble.
2. GSAP `set` on `textContent` blends strings when reverted (numbers from one string, text from the other) → overlay rendered by one span-long tween's onUpdate as a pure function of time (D-056).
3. `gsapActive` counted idle children of the paused master (72) → counts only active tweens.
4. Seeks while paused did not render a frame (cue progress lives in a ref) → `ClockFrames` invalidates on every clock change.
5. Hook labels came from a stale effect closure → read from the projected DOM labels.
6. Router `encap:link` carried no FCS arg → decoder reads the frame's last 4 bytes.
7. New dock buttons "Reset to start"/"Next event" collided with existing accessible names in older tests → renamed "Rewind to start", "Back one event", "Forward one event".
8. Wall-clock speed ratio under SwiftShader varied (2.41, 1.77, 1.48 across runs) → asserts the exact ratio against the loop's consumed wall time instead (machine-independent); raw-rate lower bound kept only for the double-loop check.

## Phase 08 — 2026-10-26

Command: `npm run verify` (exit 0) → typecheck 0, lint 0, vitest **194 passed** (9 files; new `web/src/scene/model.test.ts` 5), build ok (initial **136.25 kB gzip**, lazy `JourneyStage3D` **281.26 kB gzip**, budget 300), secrets clean, Playwright **28 passed** (1 worker).

`model.test.ts`: same-LAN → hosts A, B; link `L1 · 192.0.2.0/24`; interface labels `A.eth0 192.0.2.10/24 / 02:00:00:00:0a:10`, `B.eth0 …`. Routed → host, router, router, host; `L1 · 192.0.2.0/24`, `L2 · 198.51.100.0/30`, `L3 · 203.0.113.0/24`; 6 interfaces; R1 2 ports. Shells: app:send [app]; encap:transport [transport, app]; encap:internet [+internet]; encap:link [link, internet, transport, app] with token colours and `Ethernet · 02:00:00:00:0a:10 → 02:00:00:00:01:00`; R1 decap:link [internet, transport, app]; hop:R1:forward `TTL 64 → 63`; R1 encap:link `Ethernet · 02:00:00:00:01:01 → 02:00:00:00:02:00` + `TTL 63`; hop:R1:egress on L2 with bit stream; B decap:internet [transport, app]; B deliver [app]; state-only event → no packet. Column layout keeps devices/labels/shells, ordered top→bottom.

E2E `stage3d.spec.ts` (via `__pj.scene()`, which traverses the mounted scene graph; the step it reports is the one committed to the graph):
- lazy chunk requested; canvas aria-label; same-LAN 2 devices / 1 link / labels; routed 4 devices / 3 subnet links / 6 interface labels; `L2 · 198.51.100.0/30` visible DOM text.
- Shell layers and colours at app:send, encap:transport, encap:internet, encap:link, R1 decap:link (link shell gone), hop:R1:forward (`TTL 64 → 63` also in the visible shell label), R1 encap:link (new MACs), hop:R1:egress (L2 active, bit stream + "bit stream · teaching view"), B decap:internet, B deliver.
- Mouse click on the projected centre of `device-R2` → inspector `R2 · router` with `198.51.100.2/30`, scene R2 selected, SVG node R2 aria-pressed; keyboard Enter on SVG node R1 → inspector R1, scene selection [R1]; click on app shell → inspector "Application".
- View 2D: no canvas, note `2D view · View set to 2D`, same journey step text and identical event tag list; no WebGL (getContext → null) → `WebGL unavailable`, 2D journey visible.
- Synthetic `webglcontextlost` → note `WebGL context lost`, 3D hidden; `webglcontextrestored` → 3D back, note gone.
- Reduced motion → `Effects off · Reduced motion`, hook postprocessing false. **renderer.info.memory across 5 resets (after one warm-up): [22/2, 22/2, 22/2, 22/2, 22/2] geometries/textures.**
- 1440×900 and 390×844: each device label's box inside the stage.

### Screenshot observations
- `stage3d-1440.png` (stage 682×441, routed, hop:R1:forward, Overview): A terminal, R1 and R2 teal hex prisms, B terminal left→right; amber link labels `L1 · 192.0.2.0/24`, `L2 · 198.51.100.0/30`, `L3 · 203.0.113.0/24` above dashed tube links; six interface labels in two staggered rows below, none overlapping; glowing packet above R1 with list "Internet IPv4 · 192.0.2.10 → 203.0.113.20 · TTL 64 → 63 / Transport UDP · 50000 → 7007 / Application · 5 B"; camera bar top-left, "BLOOM + VIGNETTE" bottom-right; grid fades into fog.
- `stage3d-390.png` (column layout, 324×561): A host, R1, R2, B stacked top→bottom; link labels on the left, interface IP/MAC on the right, all readable; the wrapped shell list sits beside the packet at R1 and covers part of `R1.eth0`'s label (open issue).
- Chrome (dev server): Inspect layers first framed the shells too close and clipped the label → camera pulled back and aimed right of the packet.

### Repair log (phase 08)
1. drei `Html` labels → StrictMode "synchronously unmount a root" console errors and a missing link label → replaced by projected DOM labels (D-049).
2. Geometry count grew per reset. Instrumented: bit stream `Instances` (+1/mount) → permanent instanced mesh; static scene parts memoised; drei `Outlines` (+1 per shell toggle, default Transport selection) → always mounted, `visible` toggled (D-051).
3. Shell e2e "one step behind": first the test read the step text before the log's async toggle handler; then the real cause, "Too many active WebGL contexts", from `hasWebGL()` probing on every render, which killed the stage's context → probe once (D-051).
4. Labels overflowed at 390 px → column layout (D-050); taller mobile viewport.
5. Lazy chunk 300.95 kB > 300 → RoomEnvironment + GridHelper (D-052) → 281.26 kB.
6. Two spec files ran in parallel workers and starved SwiftShader (7 timeouts, incl. existing boot tests) → `workers: 1`; the shells test (14 steps) has a 90 s timeout.
7. Full run with the Chrome 3D tab open: 2 slow-machine timeouts that passed in isolation; closed the tab, final verify 28/28.

## Phase 07 — 2026-10-26

Command: `npm run verify` → typecheck 0, lint 0, vitest **189 passed** (8 files; new `close.test.ts` 21), build ok (initial **134.21 kB gzip**), secrets clean, Playwright **21 passed** (second run; see repair log 3).

`close.test.ts`: Hello/World + close: A CLOSED→SYN-SENT→ESTABLISHED→FIN-WAIT-1→FIN-WAIT-2→TIME-WAIT→CLOSED, B …→CLOSE-WAIT→LAST-ACK→CLOSED, all in `TCP_TRANSITIONS`; FIN {1006, 5006, ACK+FIN}, ACK {5006, 1007}, FIN {5006, 1007}, final ACK {1007, 5007}; final SND/RCV 1007/5007/5007/1007; TIME-WAIT fire − set = 400 ms, server CLOSED before it, end complete; client closes after its app:processed; close disabled → ESTABLISHED, no FIN; routed fixture same paths. No-data close: same paths, no data segment, FIN 1001/5001, server FIN 5001/1002, final ACK 1002/5002; empty message valid only as TCP + close. Lost final ACK → 1 server retransmit, `tcp:duplicate-fin`, 2 TIME-WAIT sets, 1 fire; lost client FIN → 1 retransmit; lost ACK of client FIN → server FIN+ACK path still reaches TIME-WAIT; TIME-WAIT 0 rejected. HTTP: exact CRLF request; Content-Length = UTF-8 bytes = chars + 2 (em dash); table missing→issue, known→recognized, unknown→unrecognized. Session: A issues `demo-…`, client jar holds it; B other client port, same server port, fresh handshake, recognized with cookie = issued; missing / invalid → unrecognized; per connection data seq = ISN+1, length = HTTP request bytes (≠ 5), FIN seq/ack cover request/response bytes, Content-Length = body bytes; UDP + HTTP → validation `payloadMode`, `simulate` throws; deterministic.

E2E `Close + HTTP session…`: close checkbox → tag order FIN-WAIT-1 < CLOSE-WAIT < FIN-WAIT-2 < LAST-ACK < TIME-WAIT < timer:fire:time-wait; both cards CLOSED; TIME-WAIT row "educational"; HTTP mode → A verdict unrecognized, request "GET / HTTP/1.1␍␊", response "Content-Length: 43", issued `demo-xxxxxxxx`, tuple B 192.0.2.10:50001 ↔ 192.0.2.20:7007; B → recognized, cookie sent = issued, four-tuple 50001; invalid cookie → unrecognized; UDP → mode raw, HTTP option disabled, hint "disabled for UDP".

### Browser observations (Claude in Chrome, dev server, 2D view)
- Connection A: "Cookie sent none · Server verdict unrecognized (red) · Set-Cookie issued demo-a676552f"; request 36 B `GET / HTTP/1.1␍␊ Host: 192.0.2.20␍␊ ␍␊`; response 172 B with `Content-Length: 43`, `Set-Cookie: sid=demo-a676552f; Path=/; HttpOnly`, body "Hello — new session demo-a676552f issued." (41 chars, 43 bytes). Journey ends "end:complete Run complete at 402.312 ms (SIMULATED)".
- Connection B: request 70 B with `Cookie: sid=demo-a676552f` from port 50001; verdict recognized (green); response 130 B, Content-Length 50, no Set-Cookie. TCP cards: A ISS/IRS 2000/6000, SND.NXT 2072 (= 2001 + 70 + FIN), RCV.NXT 6132; both CLOSED; TIME-WAIT "expired · educational, not an OS default"; state pills include FIN-WAIT-1 … TIME-WAIT and 12 transition rows.
- UDP: HTTP option disabled, hint shown, mode reset to raw.

### Repair log (phase 07)
1. An explain template used an ASCII apostrophe inside a single-quoted string → parse error; replaced with ’.
2. Routed close test used the wrong device names (topology ids are A/B on every template) → fixed the test.
3. First `npm run verify`: the boot test (`waitForFunction` 4 s wall clock) failed. Isolated: 1/3 pass; at stashed HEAD 3/3; with the phase 07 changes again 9/9; second full verify 21/21. Suspected cold Vite transform after the source change. Recorded as an open issue; assertion unchanged.

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
