import { describe, expect, it } from 'vitest';
import { defaultSimConfig, simulate } from '@packetjourney/shared';
import { color } from '../tokens.ts';
import { columnLayout, sceneModel, subnetOf } from './model.ts';

const at = (run: ReturnType<typeof simulate>, pred: (tag: string, dev: string) => boolean, nth = 0) =>
  run.events.filter((e) => pred(e.tag, e.device))[nth]?.index ?? -1;
const layers = (m: ReturnType<typeof sceneModel>) => m.packet?.shells.map((s) => s.layer) ?? [];

describe('scene model from fixtures', () => {
  it('same-LAN: 2 hosts, 1 link, subnet and interface labels', () => {
    const run = simulate(defaultSimConfig('same-lan', 'UDP'));
    const m = sceneModel(run, 0, '');
    expect(m.devices.map((d) => [d.id, d.kind])).toEqual([['A', 'host'], ['B', 'host']]);
    expect(m.links.map((l) => l.label)).toEqual(['L1 · 192.0.2.0/24']);
    expect(m.ifaces.map((i) => i.label)).toEqual(['A.eth0 192.0.2.10/24\n02:00:00:00:0a:10', 'B.eth0 192.0.2.20/24\n02:00:00:00:0a:20']);
  });

  it('routed: 2 hosts + 2 routers, 3 links with their own subnets, 6 interfaces', () => {
    const run = simulate(defaultSimConfig('routed', 'UDP'));
    const m = sceneModel(run, 0, '');
    expect(m.devices.map((d) => d.kind)).toEqual(['host', 'router', 'router', 'host']);
    expect(m.links.map((l) => l.label)).toEqual(['L1 · 192.0.2.0/24', 'L2 · 198.51.100.0/30', 'L3 · 203.0.113.0/24']);
    expect(m.ifaces).toHaveLength(6);
    expect(m.devices.find((d) => d.id === 'R1')?.ports).toHaveLength(2);
    expect(subnetOf('198.51.100.2', 30)).toBe('198.51.100.0/30');
  });

  it('shells mirror the snapshot at encapsulation, router and decapsulation points', () => {
    const run = simulate(defaultSimConfig('routed', 'UDP'));
    expect(layers(sceneModel(run, at(run, (t) => t === 'app:send'), ''))).toEqual(['app']);
    expect(layers(sceneModel(run, at(run, (t) => t === 'encap:transport'), ''))).toEqual(['transport', 'app']);
    expect(layers(sceneModel(run, at(run, (t) => t === 'encap:internet'), ''))).toEqual(['internet', 'transport', 'app']);
    const sent = sceneModel(run, at(run, (t) => t === 'encap:link'), '');
    expect(layers(sent)).toEqual(['link', 'internet', 'transport', 'app']);
    expect(sent.packet?.shells.map((s) => s.color)).toEqual([color.link, color.internet, color.transport, color.app]);
    expect(sent.packet?.shells[0]?.label).toBe('Ethernet · 02:00:00:00:0a:10 → 02:00:00:00:01:00');

    // At R1: link shell gone after decap, TTL 64 → 63 on forward, new MACs after re-framing.
    const decap = sceneModel(run, at(run, (t, d) => t === 'decap:link' && d === 'R1'), '');
    expect(layers(decap)).toEqual(['internet', 'transport', 'app']);
    const fwd = sceneModel(run, at(run, (t) => t === 'hop:R1:forward'), '');
    expect(fwd.packet?.shells[0]?.label).toContain('TTL 64 → 63');
    const reframed = sceneModel(run, at(run, (t, d) => t === 'encap:link' && d === 'R1'), '');
    expect(reframed.packet?.shells[0]?.label).toBe('Ethernet · 02:00:00:00:01:01 → 02:00:00:00:02:00');
    expect(reframed.packet?.shells[1]?.label).toContain('TTL 63');

    // On the link: packet sits on the active link; bit stream only while serializing.
    const tx = sceneModel(run, at(run, (t) => t === 'hop:R1:egress'), '');
    expect(tx.packet?.onLink).toBe('L2');
    expect(tx.packet?.bitStream).toBe(true);
    expect(tx.links.find((l) => l.active)?.id).toBe('L2');

    // At B: shells peel back to application data.
    expect(layers(sceneModel(run, at(run, (t, d) => t === 'decap:internet' && d === 'B'), ''))).toEqual(['transport', 'app']);
    expect(layers(sceneModel(run, at(run, (t, d) => t === 'deliver:app' && d === 'B'), ''))).toEqual(['app']);
  });

  it('state-only events show no packet', () => {
    const run = simulate(defaultSimConfig('same-lan', 'TCP'));
    expect(sceneModel(run, at(run, (t) => t === 'tcp:state:LISTEN'), '').packet).toBeNull();
  });

  it('column layout keeps entities, labels and shells; only positions move', () => {
    const run = simulate(defaultSimConfig('routed', 'UDP'));
    const i = run.events.findIndex((e) => e.tag === 'hop:R1:forward');
    const row = sceneModel(run, i, '');
    const col = columnLayout(row);
    expect(col.layout).toBe('column');
    expect(col.devices.map((d) => [d.id, d.label])).toEqual(row.devices.map((d) => [d.id, d.label]));
    expect(col.links.map((l) => l.label)).toEqual(row.links.map((l) => l.label));
    expect(col.ifaces.map((x) => x.label)).toEqual(row.ifaces.map((x) => x.label));
    expect(col.packet?.shells).toEqual(row.packet?.shells);
    // Top→bottom order follows the row order.
    const z = col.devices.map((d) => d.position[2]);
    expect([...z].sort((a, b) => a - b)).toEqual(z);
  });
});
