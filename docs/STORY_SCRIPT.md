# Story Script

Story Mode captions. Every caption is one of these templates, filled only from engine output (event arguments, frame bytes, the reducer's field map). Templates contain no hand-written numbers; `web/src/story/story.test.ts` checks that, checks that every key in `web/src/story/script.ts` is listed here, and re-derives the filled values from frame bytes for the fixtures.

## Flow

1. Questions, one at a time (validated, Back available): message, transport (TCP/UDP), ports, same network or routed, raw or HTTP (TCP only), fault (none, or lose the first data packet once: the only engine-implemented fault offered), confirmation.
2. Encapsulation: one beat per layer: Application, Transport, Internet, Link, Physical (SIMULATED teaching view). Camera: Inspect layers; the layer's key fields are highlighted with their values in the inspector.
3. Journey: TCP state changes (handshake, close), each packet's first send from an endpoint, router forwards of the request, ACKs, deliveries, drops and retransmissions. UDP stories have no state or ACK beats.
4. Decapsulation at the receiver, outermost first: Link, Internet, Transport, Application, each with its validation result.
5. Recap: process-to-process, host-to-host and hop-to-hop scopes (the journey's scope overlay follows); what changed per hop vs what stayed; two predictions answered by re-running the engine with one input changed. The Practice link opens the Practice tab (phase 12).

Typing: 45 characters per second (TypedConsole), always instantly completable (Space, Enter or click); Reduced motion shows the full text at once. Auto-play holds 3.5 s after a beat finishes typing (presentation only). The routed TCP story is tested to estimate 2 to 4 minutes at 1x.

## Templates

| Key | Template |
|---|---|
| `encap.app.title` | Application · your message |
| `encap.app.1` | Your message "{text}" is {bytes} bytes of UTF-8. |
| `encap.app.2` | Its first byte is 0x{hex0}, which travels as the bits {bin0}. |
| `encap.transport.tcp.title` | Transport · TCP segment |
| `encap.transport.tcp.1` | TCP adds a {hdr}-byte header: port {src} → {dst}, seq {seq}, ack {ack}. |
| `encap.transport.tcp.2` | Checksum {cs} covers a pseudo-header with both IP addresses, this header and your {bytes} bytes. |
| `encap.transport.udp.title` | Transport · UDP datagram |
| `encap.transport.udp.1` | UDP adds an {hdr}-byte header: port {src} → {dst}, length {len} bytes. |
| `encap.transport.udp.2` | Checksum {cs} covers a pseudo-header, this header and the data. |
| `encap.internet.title` | Internet · IPv4 packet |
| `encap.internet.1` | IPv4 adds {hdr} bytes: {srcIp} → {dstIp}, TTL {ttl}, protocol {proto}. |
| `encap.internet.2` | Header checksum {cs} protects only the IPv4 header; the packet is {total} bytes. |
| `encap.link.title` | Link · Ethernet II frame |
| `encap.link.1` | Ethernet addresses the next hop: {srcMac} → {dstMac}, EtherType 0x{etherType}. |
| `encap.link.2` | {pad} padding bytes and FCS 0x{fcs} complete a {frame}-byte frame. |
| `encap.physical.title` | Physical · bits on the wire (SIMULATED teaching view) |
| `encap.physical.1` | {dev} sends {bits} bits ({onLink} byte-times with preamble and gap) at {mbps} Mb/s. |
| `encap.physical.2` | Serialization takes {ser} ms and propagation {prop} ms on {link}. |
| `journey.state.title` | {device} · {to} |
| `journey.state.1` | {device} moves from {from} to {to}. |
| `journey.send.tcp.title` | {device} sends {label} |
| `journey.send.tcp.1` | Flags {flags}, seq {seq}, ack {ack}, {bytes} data bytes. |
| `journey.send.udp.title` | {device} sends a datagram |
| `journey.send.udp.1` | A {frame}-byte frame carrying {bytes} data bytes to port {dstPort}. |
| `journey.forward.title` | {device} forwards the packet |
| `journey.forward.1` | TTL {ttlFrom} → {ttlTo}; header checksum {csFrom} → {csTo}. |
| `journey.forward.2` | A new frame for the next hop: {srcMac} → {dstMac}. IPs and ports stay the same. |
| `journey.ack.title` | {device} receives ACK {ack} |
| `journey.ack.1` | That acknowledges {what}. |
| `journey.deliver.title` | {device} delivers {bytes} bytes |
| `journey.deliver.1` | {app} receives "{text}". |
| `journey.drop.title` | {device} drops the packet |
| `journey.drop.1` | {why} |
| `journey.retx.title` | {device} retransmits |
| `journey.retx.1` | Its timer expired; the original {frame}-byte {kind} frame is sent again. |
| `decap.link.title` | {device} · Link layer |
| `decap.link.1` | Destination MAC {dstMac} is this interface and the FCS checks out. |
| `decap.link.2` | Ethernet header, {pad} padding bytes and FCS are removed, leaving {bytes} bytes. |
| `decap.internet.title` | {device} · Internet layer |
| `decap.internet.1` | IPv4 checksum {cs} is valid, destination {dst} is this host, TTL {ttl}. |
| `decap.internet.2` | The IPv4 header is removed, leaving a {bytes}-byte {unit}. |
| `decap.transport.title` | {device} · Transport layer |
| `decap.transport.tcp.1` | TCP checksum {cs} verifies; seq {seq} is the next byte expected. |
| `decap.transport.udp.1` | UDP checksum {cs} verifies; length {length} matches. |
| `decap.transport.2` | Port {port} belongs to {app}. |
| `decap.app.title` | {device} · Application |
| `decap.app.1` | {app} reads {bytes} bytes: "{text}", unchanged end to end. |
| `decap.missing.title` | The data never reached {device} |
| `decap.missing.1` | No delivery event exists for this packet in the run. |
| `recap.process.title` | Recap · process to process |
| `recap.process.1` | Ports pick the applications: {cIp}:{cPort} ⇄ {sIp}:{sPort} over {proto}. |
| `recap.host.title` | Recap · host to host |
| `recap.host.1` | IPv4 carries {cIp} → {sIp} unchanged across {hops} link(s); routers never rewrite them. |
| `recap.hop.title` | Recap · hop to hop |
| `recap.hop.1` | Each link has its own MAC pair: {macs}. |
| `recap.changes.title` | Recap · what changed, what stayed |
| `recap.changes.1` | Per hop the TTL went {ttls}, and MACs, IP checksum and FCS were rebuilt. |
| `recap.changes.2` | IPs, ports and the transport checksum {tcs} stayed constant on every hop. |
| `recap.predict.title` | Recap · predict |
| `recap.predict.1` | Two quick predictions, answered by re-running the engine. |
| `predict.ttl.q` | With an initial TTL of {ttl}, where would your request stop? |
| `predict.ttl.a.drop` | At {device}: TTL would expire there, so it drops the packet (ICMP NOT BUILT). |
| `predict.ttl.a.ok` | It still arrives at {device}: no router decrements TTL on a single link. |
| `predict.ack.q` | If your message were one byte longer, which ACK would the server send? |
| `predict.ack.a` | ACK {ack}: it acknowledges every byte, so it grows by one. |
| `predict.udpack.q` | How many ACK segments did UDP send in this run? |
| `predict.udpack.a` | {n}: UDP has no acknowledgements; loss is not repaired. |
