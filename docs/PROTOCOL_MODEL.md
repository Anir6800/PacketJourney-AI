# Protocol Model

What the engine simulates, how faithfully, and what it simplifies. Phase 02 built the encoders (`shared/src/`); state machines, routing, ARP and faults are still **NOT BUILT**.

## Routed delivery and scopes (phase 06)

**Routed fixture (fixed, no editor; RFC 5737 documentation addresses, locally administered MACs):**

| Device | Interface | IPv4 | MAC | Routes |
|---|---|---|---|---|
| Sender A | eth0 | 192.0.2.10/24 | 02:00:00:00:0a:10 | 192.0.2.0/24 direct; default via 192.0.2.1 |
| R1 | eth0 | 192.0.2.1/24 | 02:00:00:00:01:00 | 192.0.2.0/24 direct eth0; 198.51.100.0/30 direct eth1; 203.0.113.0/24 via 198.51.100.2 |
| R1 | eth1 | 198.51.100.1/30 | 02:00:00:00:01:01 | |
| R2 | eth0 | 198.51.100.2/30 | 02:00:00:00:02:00 | 198.51.100.0/30 direct eth0; 203.0.113.0/24 direct eth1; 192.0.2.0/24 via 198.51.100.1 |
| R2 | eth1 | 203.0.113.1/24 | 02:00:00:00:02:01 | |
| Receiver B | eth0 | 203.0.113.20/24 | 02:00:00:00:0c:20 | 203.0.113.0/24 direct; default via 203.0.113.1 |

Links: L1 A–R1 100 Mb/s 500 ns; L2 R1–R2 10 Mb/s 2 ms; L3 R2–B 100 Mb/s 500 ns (SIMULATED). Same-LAN alternative: A 192.0.2.10 ↔ B 192.0.2.20 on one link. Routers have no default route.

**Forwarding:** every send (host or router) does a longest-prefix lookup (`route:lookup` event: matched route, next hop, egress, next-hop MAC). Next-hop MACs come from **prepopulated ARP caches** (each interface knows its link neighbour); the ARP exchange is NOT BUILT and the UI says so. At each router: `verify:link` (FCS, dst MAC) → `decap:link` → `verify:internet` (header checksum) → TTL check (TTL ≤ 1 → `drop:ttl`, local drop; ICMP Time Exceeded NOT BUILT) → `route:lookup` → `hop:Rn:forward` (TTL − 1, header checksum recomputed) → new Ethernet header (egress MAC → next-hop MAC) + FCS → transmit. No NAT: endpoint IPs and ports never change. The transport segment is byte-identical on every hop and its checksum stays valid because the pseudo-header (RFC 768 / RFC 9293 §3.1) contains addresses, protocol and length but not TTL. The receiving host verifies but does not decrement TTL. Replies use the reverse routes. A missing route would drop locally (ICMP Destination Unreachable NOT BUILT).

**TCP is end-to-end:** only A and B hold TCP state; routers forward segments and never handshake (tested: tcp transitions occur only on A and B).

**Scope overlays (2D journey):** Process ↔ process (ports/apps, arc between endpoints, routers dimmed), Host ↔ host (src/dst IP and TTL read from the current frame), Hop ↔ hop (current link, both interface IP/MAC, current frame's MACs and FCS, ARP note, device route table with the matched route highlighted).

## TCP connect and data (phase 05)

Scoped state machine (`shared/src/sim/tcp.ts`, RFC 9293 §3.3.2): CLOSED, LISTEN, SYN-SENT, SYN-RECEIVED, ESTABLISHED and the five transitions between them. Every `tcp:state:*` event is checked against that table; the UI diagram renders the same table. Close states are NOT BUILT.

**Teaching ISNs:** client 1000, server 5000 (configurable, unsigned 32-bit). They are deliberately readable, **not** the unpredictable ISNs RFC 9293 §3.4.1 / RFC 6528 require. All sequence arithmetic is modulo 2^32 (tested at 4294967295 → 0).

**Fixture (raw `Hello`, reply `World`):**

| Segment | From | Flags | SEQ | ACK | Consumes |
|---|---|---|---|---|---|
| SYN | A | SYN | 1000 | 0 | 1 |
| SYN-ACK | B | SYN, ACK | 5000 | 1001 | 1 |
| ACK | A | ACK | 1001 | 5001 | 0 |
| data "Hello" | A | ACK, PSH | 1001 | 5001 | 5 |
| ACK | B | ACK | 5001 | 1006 | 0 |
| reply "World" | B | ACK, PSH | 5001 | 1006 | 5 |
| ACK | A | ACK | 1006 | 5006 | 0 |

Sequence numbers count bytes (UTF-8), not packets; a pure ACK consumes none. The client app's write at t = 0 is **queued** in the send buffer and only segmented after the client is ESTABLISHED; nothing is delivered before ESTABLISHED.

**Pedagogical choices:** no delayed ACK (each data segment ACKed immediately), no Nagle, one data segment per direction, no options (real SYNs carry MSS etc.), no congestion control, SACK or window scaling; fixed window 64240. The server's 1 ms app delay makes the transport ACK and `app:processed` separate events.

**Recovery cases modelled:** lost SYN / SYN-ACK / data → RTO retransmission with backoff; lost handshake ACK → the server reaches ESTABLISHED on the data segment's ACK (RFC 9293 §3.10.7.4) and a retransmitted SYN-ACK in ESTABLISHED is re-ACKed. No listener → `socket:none`; RST is NOT BUILT, so the client retries then gives up.

## UDP vertical slice (phase 04)

Default run: **Same-LAN, UDP**, client A `192.168.1.10:50000` → server B `192.168.1.20:7007` (echo app). A **custom UDP echo** — not HTTP, and not the RFC 862 Echo service on port 7.

Pipeline per packet: `app:send` → `encap:transport` (UDP header + checksum) → `encap:internet` → `encap:link` → `hop:A:egress` → `hop:B:ingress` → `verify:link` (FCS residue + destination MAC is this interface) → `decap:link` → `verify:internet` (version 4, header checksum, destination is this host) → `decap:internet` → `verify:transport` (UDP length matches; checksum verified over pseudo-header, or skipped when 0) → `socket:select` (destination port → bound application) → `decap:transport` (**transport accepted**) → `deliver:app` → `app:processed` (**application processed**) → `app:respond` (reply with swapped IPs/ports, configured text) → same path back.

- Sockets: client app bound to the client port; echo app bound to the server's listening port. A datagram to any other port gets `socket:none` and is discarded; no app receives it. A real host would send ICMP Port Unreachable (RFC 1122 §4.1.3.1, RFC 792) — NOT BUILT.
- No session, SYN, ACK, timer, retransmit or close events exist for UDP (tested).
- Reply can be disabled; the server still processes the request.
- UDP checksum default on; when off, 0 is transmitted and the receiver skips the check (RFC 768; IPv6 would require it, RFC 8200).
- Every receive-side check is computed from the actual bytes; a failure emits `drop:<layer>` with the reason.

**Input validation (demo restrictions beyond the header fields):** IPv4 dotted quad, no leading zeros, not 0/8, 127/8, ≥224, and not .0/.255 in the /24; same-LAN hosts share one /24 and differ; MACs unicast (I/G bit 0), non-zero, distinct; ports 1–65535 (0 is representable but unsupported); reply text 1–256 bytes when enabled. Routed template keeps fixture addresses (routing NOT BUILT); ports remain editable.

## Event engine (phase 03, `shared/src/sim`)

**Pipeline:** `SimConfig` (deep-frozen copy) → `simulate()` discrete-event loop → immutable `SimulationEvent[]` → `reduce` → `SnapshotTimeline.at(index)` / `.atTime(ms)` (checkpoints every 16 events). No React, GSAP, Three.js, timers or wall clock.

**SimulationEvent:** `id`, `index`, `virtualTimeNs` (integer) + `virtualTimeMs`, `tieBreak` (scheduler insertion seq), `flowId`, `packetId`, `device`, `iface`, `direction`, `layer`, `type`, semantic `tag`, `bytes`, `transition` (tcp/app/timer/packet from→to), `explainKey` + `explainArgs`, `causeId`, `timing`, `effects` (the only way state changes).

**Semantic tags:** `session:start`, `app:send`, `app:respond`, `encap:transport|internet|link`, `hop:<dev>:egress|ingress|forward`, `decap:link|internet|transport`, `deliver:app`, `ack`, `ack:duplicate`, `tcp:duplicate`, `tcp:retransmit`, `timer:set:rto`, `timer:cancel:rto`, `timer:fire:rto`, `timer:giveup`, `drop`, `end:complete|event-cap|max-duration`.

**State:** per endpoint TCP state, SND.UNA/SND.NXT/RCV.NXT, send buffer (unacked), receive buffer, delivered bytes, app state, timers `{generation, armed, deadline, retries}`; per packet original frame, current frame, location, status, attempt; active hop; first-data-packet units + field map; metrics; end reason.

**Scheduler:** binary heap ordered by (time ns, priority, insertion seq) → equal timestamps keep insertion order. Explicit `maxEvents` (default 400) and `maxDurationMs` (5000) end the run with an `end:*` event. Timer callbacks carry a generation; cancelling bumps it, so stale callbacks are skipped without emitting events or advancing time.

**Templates:** `same-lan` (A —L1 100 Mb/s, 500 ns— B) and `routed` (A —L1 100 Mb/s, 500 ns— R1 —L2 10 Mb/s, 2 ms— B). Host processing 20 µs, router 50 µs, server app response 1 ms. All **SIMULATED** illustrative values; routing lookup NOT BUILT (template path, replies reverse it).

**Timing:** serialization = ⌈on-link bits × 10⁹ / bps⌉ ns, where on-link bytes = 8 (preamble+SFD) + frame + 12 (interframe gap); then propagation; send-start, send-end and arrival are stored separately. A busy link queues the next frame (FIFO). Two metrics are kept apart: frame bytes (dst MAC…FCS) and link occupancy (byte-times incl. preamble/SFD/IFG).

**TCP behaviour (phase 03; superseded by the phase 05 handshake above):** data → immediate pure ACK (no delayed ACK); in-order delivery via RCV.NXT, duplicates discarded and re-ACKed; RTO fixed 200 ms with exponential backoff (RFC 6298 §5.5) up to `maxRetries` (3), then give up. Retransmissions resend the original frame bytes (same IP ID — simplification). UDP: no ACKs/timers.

**Router forwarding:** decapsulate frame, TTL − 1 (drop at ≤ 1), recompute header checksum (RFC 1812 §5.3.1), new Ethernet header (egress MAC → next-hop MAC), new FCS. IP addresses and transport bytes unchanged.

**Faults:** only `loss` (per packet kind, count) has behaviour, to exercise bounded retries; fault UI and other kinds NOT BUILT.

## Implemented in phase 02 (`shared/src`)
| Module | Contents |
|---|---|
| `schemas.ts` | zod schemas: Endpoint, Interface, Route (direct/via), Payload, TransportConfig (TCP/UDP discriminated), Fault (discriminated; behaviour NOT BUILT), ScenarioConfig, Field, EngineEvent, Snapshot |
| `bytes.ts` | UTF-8 via `TextEncoder`; per-code-point text/hex/binary groups; payload validation 1–256 bytes (no truncation) |
| `checksum.ts` | RFC 1071 sum/verify (odd byte zero-padded for arithmetic only, carried across chunks); pseudo-header; UDP 0→0xFFFF; CRC-32 + FCS serialization |
| `encode.ts` | TCP/UDP/IPv4/Ethernet II encoders, MSB-first bit packing in network byte order; field map |
| `events.ts` | `payload-encoded` → `header-built` ×3 events (tUs = 0, SIMULATED), reducer, `snapshotAt` |
| `fixtures.ts` | Seeded demo topology (RFC 1918, locally administered MACs, IANA dynamic source port) |

### Byte counts
- Payload: `TextEncoder` bytes, 1–256 per segment/datagram; longer input is rejected with a message, never truncated. JS `string.length` (UTF-16 units) is never used as a length.
- UDP length = 8 + payload. TCP header = 20 (data offset 5). IPv4 total length = 20 + transport, **excluding** Ethernet padding.
- Ethernet: 14-byte header + payload padded with zeros to 46 + 4-byte FCS ⇒ minimum frame 64 bytes. "Frame bytes" = destination MAC … FCS; preamble (7), SFD (1) and interframe gap (12 byte-times) are not part of them.

### FCS convention
CRC-32 per IEEE 802.3 (reflected poly 0xEDB88320, init and final XOR 0xFFFFFFFF) over destination MAC through padding. Displayed as the CRC value (e.g. `0x08FC68AB`) **and** as wire bytes least-significant octet first (`AB 68 FC 08`), the order in which captures show it. Self-check: CRC-32 over the whole frame including FCS equals the residue `0x2144DF1C`.

### Field map
Each field records: id (unique), header, layer colour key, name, absolute bit offset/width in the frame, byte range `[byteStart, byteEnd)`, raw value, display, status (`calculated` / `configured` / `illustrative`), value source, explanation and a stable `order` (payload → transport → IPv4 → Ethernet header → padding → FCS) for later cinematic assembly. The same spec list packs the bytes and produces the map, so they cannot drift. Fields tile the frame exactly (tested).

### TCP flags
Modelled (configured): ACK, PSH, RST, SYN, FIN. Displayed-only, always 0, labelled "Not modelled": CWR, ECE (RFC 3168), URG and the urgent pointer. Phase 02 builds one data segment with ACK+PSH; seq/ack come from the seeded PRNG because the handshake is NOT BUILT.

## Sources (primary)

| Topic | Source |
|---|---|
| Layers | RFC 1122 *Requirements for Internet Hosts — Communication Layers* |
| TCP | RFC 9293 *Transmission Control Protocol* (2022, obsoletes RFC 793) |
| UDP | RFC 768 *User Datagram Protocol* |
| IPv4 | RFC 791 *Internet Protocol* |
| Checksum | RFC 1071 *Computing the Internet Checksum* |
| ARP | RFC 826 *An Ethernet Address Resolution Protocol* |
| Ethernet framing | IEEE 802.3 (Ethernet II / DIX type field) |
| UTF-8 | RFC 3629 |
| Documentation addressing | RFC 5737 (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24) — used for all fixtures since phase 06 |
| Checksum incremental update (TTL) | RFC 1624 (observed: TTL −1 raises the header checksum by 0x0100) |
| ECN / DSCP | RFC 3168, RFC 2474 |
| Ephemeral ports | RFC 6335 (49152–65535) |
| RTO backoff | RFC 6298 §5.5 (doubling); RTO value itself is fixed, not §2 estimation |
| Router forwarding | RFC 1812 §5.3.1 (TTL), §5.2.2 (checksum update) |
| Ethernet preamble/SFD/IFG sizes | IEEE 802.3 (7 + 1 bytes; 96 bit-time gap) |
| CRC-32 check values | standard CRC-32/ISO-HDLC catalogue values ("123456789" → 0xCBF43926) |

## Layers (four, per RFC 1122)

1. **Application** — the user's message, UTF-8 encoded (RFC 3629).
2. **Transport** — TCP segment or UDP datagram.
3. **Internet** — IPv4 packet.
4. **Link** — Ethernet II frame.

*Physical* (bits/signal on a medium) is a **teaching view only**, not a fifth TCP/IP layer.

## Header models

### UDP (RFC 768) — 8 bytes
Source port (16) · Destination port (16) · Length (16, header + data) · Checksum (16).
Checksum covers a pseudo-header (src IP, dst IP, zero, protocol 17, UDP length) + header + data. In IPv4 a transmitted checksum of 0 means "not computed"; a computed result of 0 is sent as 0xFFFF. The engine always computes it.

### TCP (RFC 9293 §3.1) — 20 bytes, no options
Source port · Destination port · Sequence number (32) · Acknowledgment number (32) · Data offset (4) = 5 · Reserved (4) · Flags CWR ECE URG ACK PSH RST SYN FIN · Window (16) · Checksum (16) · Urgent pointer (16).
Checksum uses the same pseudo-header form with protocol 6 and TCP length.

### IPv4 (RFC 791) — 20 bytes, no options
Version 4 · IHL 5 · DSCP/ECN 0 · Total length · Identification (seeded) · Flags (DF set) · Fragment offset 0 · TTL (default 64) · Protocol (6 TCP / 17 UDP) · Header checksum · Source · Destination.
Header checksum covers the IPv4 header only and is **recomputed at every router** because TTL changes.

### Ethernet II — 14-byte header + 4-byte FCS
Destination MAC · Source MAC · EtherType 0x0800 (IPv4) / 0x0806 (ARP). Payload minimum 46 bytes (padded). FCS is CRC-32; the engine may display it as a computed value. Preamble/SFD belong to the physical teaching view.

### Internet checksum (RFC 1071)
One's-complement sum of 16-bit words (odd length padded with a zero byte for computation only), end-around carry folded, then complemented. Verification: sum over data including checksum yields 0xFFFF.

## TCP behaviour (RFC 9293 §3.3.2 state machine)

Modelled states: CLOSED, LISTEN, SYN-SENT, SYN-RECEIVED, ESTABLISHED, FIN-WAIT-1, FIN-WAIT-2, CLOSE-WAIT, CLOSING, LAST-ACK, TIME-WAIT.

- **Connect**: SYN (seq = ISN_c) → SYN+ACK (seq = ISN_s, ack = ISN_c+1) → ACK. SYN and FIN each consume one sequence number.
- **Data**: bytes numbered by sequence; cumulative ACK = next expected byte.
- **Close**: FIN/ACK exchange in each direction; active closer waits in TIME-WAIT for 2×MSL (simulated, shortened and labelled).
- **Loss (fault)**: retransmission after a simulated RTO; duplicate segments ACKed and discarded.

## Delivery scopes

- **Loopback**: 127.0.0.1; no link-layer frame on a wire (shown as such).
- **Same link**: destination in the sender's subnet → ARP request (broadcast) / reply (unicast) → frame to destination MAC.
- **Routed**: destination outside subnet → frame to default gateway's MAC; each router: decapsulate frame → check/decrement TTL (drop at 0; ICMP Time Exceeded shown as text, ICMP not fully modelled) → longest-prefix route lookup → recompute IP checksum → new frame with new src/dst MACs. IP addresses unchanged end to end (no NAT).

## Simplifications (deliberate, stated in UI)

- ISNs, ports, IP IDs and MACs come from a seeded PRNG, not RFC 9293's clock-based ISN generator or RFC 6528 hashing.
- Fixed receive window; no congestion control, window scaling, SACK, timestamps, MSS option negotiation (MSS assumed 1460), Nagle, delayed ACK, or urgent data.
- RTO is a fixed simulated value, not RFC 6298 estimation.
- No IP fragmentation, IP options, IPv6, NAT, VLANs.
- ARP caches are per-scenario and start empty.
- All timings are **SIMULATED** virtual time.
- This is **not** a compliant TCP implementation; it models the parts needed to teach the journey.
