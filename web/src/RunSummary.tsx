import type { SimRun } from '@packetjourney/shared';

export function RunSummary({ run, connection }: { run: SimRun; connection: 'a' | 'b' | undefined }) {
  const final = run.timeline.final;
  const delivered = run.events.filter((e) => e.tag === 'deliver:app').length;
  return (
    <section className="print-summary" aria-label="Printable single-run summary">
      <h1>PacketJourney AI · single-run summary</h1>
      <p><strong>SIMULATED</strong> · generated locally · no packet capture or real network traffic</p>
      <dl>
        <dt>Model</dt><dd>14</dd>
        <dt>Seed</dt><dd>{run.config.seed}</dd>
        <dt>Protocol</dt><dd>{run.config.protocol}</dd>
        <dt>Scenario</dt><dd>{run.config.template}{connection ? ` · HTTP connection ${connection.toUpperCase()}` : ''}</dd>
        <dt>Endpoints</dt><dd>{run.config.endpoints.client.ip}:{run.config.endpoints.client.port} → {run.config.endpoints.server.ip}:{run.config.requestDstPort}</dd>
        <dt>Events</dt><dd>{run.events.length}</dd>
        <dt>Virtual end</dt><dd>{final.end?.atMs ?? 0} ms · SIMULATED</dd>
        <dt>Frames</dt><dd>{final.metrics.framesSent} · {final.metrics.frameBytesSent} frame bytes</dd>
        <dt>Delivery</dt><dd>{delivered} application delivery event(s) · {final.metrics.drops} drop(s) · {final.metrics.retransmissions} retransmission(s)</dd>
        <dt>End reason</dt><dd>{final.end?.reason ?? 'not complete'}</dd>
      </dl>
      <h2>Assumptions</h2>
      <p>Teaching ISNs and timing are simulated. ARP caches are prepopulated. TCP uses a fixed educational RTO and omits congestion control, SACK, window scaling and options. IPv6, fragmentation, NAT, TLS, ICMP generation and packet capture are NOT BUILT. Performance is NOT MEASURED.</p>
    </section>
  );
}
