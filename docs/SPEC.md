# PacketJourney AI — Specification

PacketJourney AI is a **local, educational TCP/IP visualizer**. Everything it shows is **SIMULATED**: a browser cannot open arbitrary raw TCP/UDP sockets or capture packets, and this app never tries to. Bytes, headers, checksums and state transitions are computed by a deterministic in-browser engine; every timing is virtual time.

## 1. Architecture (non-negotiable)

```
pure byte encoders + protocol state machines  (shared/engine, later phase)
        │  produce
        ▼
immutable, deterministic, seeded events  ──►  reducer  ──►  snapshots
                                                             │
        ┌──────────────────┬──────────────────┬──────────────┼───────────────┐
        ▼                  ▼                  ▼              ▼               ▼
   2D inspector       3D stage (R3F)     2D SVG journey   Story console   Timeline
                           ▲
   pure cue builder: events → presentation cues → paused GSAP master timeline
   seeked by ONE playback clock (GSAP never owns simulated time or protocol facts)
```

- Virtual (simulated) time is independent of wall-clock playback speed.
- Every caption, label and number shown comes from an engine snapshot. No hardcoded animated results.
- The 3D scene reads snapshot + cue progress and never mutates engine state.
- The AI tutor explains snapshots; it is never authoritative over protocol facts.
- Fixtures are seeded (ISN, ports, IDs) so runs are reproducible.

## 2. The four TCP/IP layers

Per RFC 1122 the model has four layers: **Application, Transport, Internet, Link**. Physical transmission (bits on a wire/medium) is shown as a *teaching view* beneath the Link layer, explicitly labelled as **not a fifth TCP/IP layer**.

## 3. Capabilities

| # | Capability | Summary |
|---|---|---|
| C1 | TCP/UDP choice | User picks TCP (RFC 9293) or UDP (RFC 768) per application session; the UI explains the trade-off (connection, ordering, reliability vs. none). |
| C2 | UTF-8 / hex / binary | Payload text is UTF-8 encoded; every byte is viewable as text, hex and binary, with multi-byte code points grouped. |
| C3 | Headers and calculations | Field-by-field TCP, UDP, IPv4 and Ethernet II headers; Internet checksum (RFC 1071) with pseudo-header worked step by step; lengths, offsets, TTL, flags. |
| C4 | Encapsulation / decapsulation | Data wrapped layer by layer (segment/datagram → packet → frame) and unwrapped at the receiver, each step a discrete event. |
| C5 | TCP connect / data / close | Three-way handshake, sequenced data with cumulative ACKs, FIN-based close with TIME-WAIT, driven by the RFC 9293 state machine. |
| C6 | Replies and independent sessions | Receivers reply; multiple application sessions run concurrently, distinguished by port 4-tuples, each with its own state. |
| C7 | Delivery scopes | Loopback (same host), same link (ARP resolution, RFC 826), and routed (different network via gateway). |
| C8 | Routed forwarding | Routers decapsulate to IP, longest-prefix match, decrement TTL, recompute the IPv4 header checksum, re-frame with new MAC addresses per hop. |
| C9 | Playback | Play/pause/step/seek/speed on one clock; any step is reachable; virtual time shown separately from playback speed. |
| C10 | AI tutor | Optional local server explains the *current snapshot*; answers are labelled non-authoritative; app works fully without it. |
| C11 | Faults | Injected, seeded faults: loss, corruption (checksum fails), duplication, reordering, TTL expiry; TCP retransmission responses shown. |
| C12 | Predict / compare | Learner predicts a field or outcome before reveal; app compares prediction against engine truth and explains the gap. |

## 4. Modes

### Story Mode (guided)
Typed narration, **one question at a time** (e.g. "What will you send?", "TCP or UDP?", "Where is the receiver?"), then: layer-by-layer encapsulation → journey across the network → decapsulation at the receiver → recap. Each beat is steppable and replayable. Script lives in `STORY_SCRIPT.md`; storyboard in `EXPERIENCE.md`.

### Lab Mode (free)
All controls exposed: topology, protocol, payload, faults, playback. No narration; inspector and timeline are primary.

### Director demo mode
Scripted, hands-off run of a Story chapter for presentations (keyboard-advanced or auto-advanced at fixed playback speed). Uses the same engine and cues; no special-case results.

## 5. Presentation

- **Hybrid stage**: lazily loaded 3D journey stage (R3F) + crisp 2D DOM inspector. Essential text is never only inside WebGL.
- **2D fallback**: an SVG journey showing the *identical* steps, used when WebGL is unavailable, the context is lost, or View = 2D.
- **View setting**: 3D / 2D.
- **Motion setting**: Cinematic / Reduced. Default follows `prefers-reduced-motion`. Reduced = no camera moves, typing, scramble or bloom pulses; state changes instantly and remains steppable.
- **SIMULATED badge** is always visible.

## 6. Explicit exclusions

- No real sockets, packet capture, raw network access, or real latency measurement.
- No hosting, login, database or cloud dependency for core features.
- No claim of full TCP compliance. Out of scope: congestion control algorithms, SACK, window scaling and other options, Nagle, urgent data, IPv6, IP fragmentation (NOT BUILT; may be noted in text), DNS, TLS.
- No third-party 3D models, brand logos or copyrighted assets.
- Real-world performance claims: NOT MEASURED unless recorded in `TEST_EVIDENCE.md`.

## 7. Requirements-to-test matrix

Status: `planned` / `implemented` / `verified` / `blocked`.

| ID | Requirement | Test | Status |
|---|---|---|---|
| F0.1 | Workspace installs from lockfile | `npm ci` | verified |
| F0.2 | Dark shell with SIMULATED badge | e2e `dark shell shows SIMULATED badge` | verified |
| F0.3 | Lazy 3D chunk renders smoke mesh | e2e `lazy 3D stage renders the smoke mesh` | verified |
| F0.4 | GSAP via useGSAP, contexts revert (phase-00 smoke tween replaced by the boot timeline) | e2e `boot: plays once under StrictMode` (`gsapActive()==0` after) | verified |
| F0.5 | Reduced motion: no tweens | e2e `reduced motion: final states, no tweens` | verified |
| F0.6 | View 2D shows SVG fallback | e2e `View 2D shows the SVG fallback` | verified |
| F0.7 | `/api/health` schema-valid; foreign origins rejected | vitest `server/src/app.test.ts` | verified |
| F0.8 | Core app runs with AI server down | e2e `core app runs with AI server down` | verified |
| F0.9 | No API key in web source/build | `npm run check:secrets` | verified |
| F0.10 | WebGL context loss → 2D fallback | handler implemented; no automated test yet | implemented |
| D1.1 | Layout 1440/1280/390 without overflow or clipping | e2e `layout WxH` ×3 | verified |
| D1.2 | Boot ≤ 2.5 s, skippable by key/click, once per session, once under StrictMode | e2e `boot:` ×2 | verified |
| D1.3 | Keyboard reaches mode switch, tabs, inspector (panel and drawer) | e2e `keyboard reaches…`, `1280: inspector drawer` | verified |
| D1.4 | Every text pair AA, measured | vitest `contrast.test.ts` (36 pairs) | verified |
| D1.5 | Reduced motion: final states, no tweens, grid drift off | e2e `reduced motion…` | verified |
| D1.6 | No GSAP console warnings | e2e afterEach console filter | verified |
| D1.7 | TypedConsole: Enter completes; one announcement per line | e2e `TypedConsole…` | verified |
| D1.8 | Grid drift pauses when tab hidden | CSS `[data-hidden=true]`; no automated test | implemented |
| E3.1 | Same config + seed → identical events/bytes | `sim.test.ts` determinism ×4 templates/protocols; e2e `run lifecycle` | verified |
| E3.2 | Equal timestamps keep order; time never decreases | `sim.test.ts` scheduler + ordering | verified |
| E3.3 | New run cancels prior state; config frozen; dirty draft needs explicit Run/Reset | `sim.test.ts` run lifecycle; e2e `run lifecycle` | verified |
| E3.4 | snapshotAt replay = forward execution | `sim.test.ts` snapshots (5 configs, every index, backward seeks) | verified |
| E3.5 | Playback speed can't change virtual timing/metrics | `sim.test.ts` playback speed (0.25×/1×/8× stand-in clock) | verified |
| E3.6 | Every event has a semantic tag + explanation | `sim.test.ts` ordering suite | verified |
| E3.7 | Bounded retries, event cap, max duration | `sim.test.ts` faults and bounds | verified |
| U4.1 | Hello arrives unchanged; configured reply returns | `udp.test.ts`; e2e `UDP slice: Hello delivered…` | verified |
| U4.2 | Wrong destination port reaches no app | `udp.test.ts`; e2e `UDP slice: wrong port…` | verified |
| U4.3 | Invalid IP/MAC/port/duplicates block the run inline | `udp.test.ts` validation (16 cases); e2e | verified |
| U4.4 | UDP has no handshake/ACK/timer events; reply can be disabled | `udp.test.ts`; e2e | verified |
| U4.5 | Link + transport byte maps equal encoded buffers | `udp.test.ts` byte maps; e2e layer-card bytes | verified |
| U4.6 | 2D journey with layer cards, two receiver statuses, expandable event details | e2e `UDP slice…` | verified |
| U4.7 | 2D journey stays feature-complete as the WebGL fallback in later phases | per-phase e2e (TCP cards added in 05) | implemented |
| T5.1 | Exact SYN/SYN-ACK/ACK/data/ACK/reply/ACK numbers for Hello/World | `tcp.test.ts`; e2e `TCP: handshake…` | verified |
| T5.2 | Unicode byte counts drive SEQ/ACK; modulo 2^32 | `tcp.test.ts` | verified |
| T5.3 | No delivery before ESTABLISHED; pure ACK consumes no sequence space | `tcp.test.ts` | verified |
| T5.4 | Transport ACK distinct from app processing | `tcp.test.ts`; e2e | verified |
| T5.5 | State cards (both endpoints, four-tuple) and diagram agree with headers and log | e2e `TCP: handshake…` | verified |
| T5.6 | Switching protocol clears TCP state | `tcp.test.ts`; e2e | verified |
| T5.7 | TCP close (FIN, TIME-WAIT) | — | planned |
| C1 | TCP/UDP choice | engine + UI tests | planned |
| C2 | UTF-8/hex/binary | `shared/src/engine.test.ts` UTF-8 suite; e2e `payload validation` | verified |
| C3 | Headers & checksums (single segment/datagram, no options) | engine tests: RFC 1071 §3, IPv4 0xB861 vector, CRC-32 check values, reference checksum, bit flips, field map; e2e `Headers: selecting a field…` | verified |
| C4 | Encapsulation/decapsulation | event-sequence tests | planned |
| C5 | TCP connect/data/close | state-machine transition tests vs RFC 9293 | planned |
| C6 | Replies & independent sessions | multi-session reducer tests | planned |
| C7 | Delivery scopes | scenario tests per scope | planned |
| C8 | Routed forwarding | TTL/checksum/MAC rewrite per hop tests | planned |
| C9 | Playback | clock/seek determinism tests + e2e | planned |
| C10 | AI tutor | server contract tests; offline e2e | planned |
| C11 | Faults | seeded fault scenario tests | planned |
| C12 | Predict/compare | comparison logic tests + e2e | planned |
| S1 | Story Mode flow | e2e walkthrough | planned |
| S2 | Lab Mode | e2e | planned |
| S3 | Director demo mode | e2e | planned |
| S4 | 2D fallback parity with 3D steps | same snapshot drives both; e2e step count | planned |
