import { routeText, type Template } from '@packetjourney/shared';
import { HudLabel } from './ui.tsx';

/** Inspector view of one device from the run's fixed topology (shared by 3D and 2D selection). */
export function DeviceDetail({ t, id }: { t: Template; id: string }) {
  const d = t.devices[id];
  if (!d) return null;
  return (
    <div data-testid="device-detail">
      <h2 className="layer-title">
        {d.id} · {d.kind}
      </h2>
      <HudLabel>Interfaces</HudLabel>
      <dl className="facts mono">
        {d.ifaces.map((i) => (
          <div key={i.name} style={{ display: 'contents' }}>
            <dt>{i.name}</dt>
            <dd>
              {i.ip}/{i.prefixLength} · {i.mac}
            </dd>
          </div>
        ))}
      </dl>
      <HudLabel>Route table</HudLabel>
      <ul className="fields mono">
        {d.routes.map((r) => (
          <li key={routeText(r)}>{routeText(r)}</li>
        ))}
      </ul>
      <p className="small muted">ARP cache prepopulated (ARP exchange NOT BUILT).</p>
    </div>
  );
}
