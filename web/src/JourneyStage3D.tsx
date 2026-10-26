import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Instance, Instances, Line, MeshTransmissionMaterial, OrbitControls, Outlines } from '@react-three/drei';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';
import { ACESFilmicToneMapping, CatmullRomCurve3, DoubleSide, Matrix4, MeshPhysicalMaterial, type InstancedMesh, SRGBColorSpace, Vector3, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import type { Line2, LineSegments2, OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PMREMGenerator } from 'three';
import { debug } from './debug.ts';
import { color } from './tokens.ts';
import { Segmented } from './ui.tsx';
import { budgetStep, BUDGET_MISSES } from './scene/budget.ts';
import { SHELL_ORDER, columnLayout, type SceneDevice, type SceneLink, type SceneModel, type ShellLayer, type Vec3 } from './scene/model.ts';
import type { Selection } from './selection.ts';
import { gsap } from './gsap.ts';
import { ease } from './tokens.ts';
import type { Motion as MotionApi } from './motion/motion.ts';

// Lazy chunk. Renders the pure scene model only: no protocol logic, no engine mutation.
// Motion: every frame reads the playback position (cue + progress) from a ref; nothing re-renders React per frame.
// Visuals are a pure function of (snapshot model, cue progress), so scrubbing back reproduces them exactly.

export type Rig = 'overview' | 'follow' | 'inspect';
type Props = {
  model: SceneModel;
  selected: Selection;
  onSelect: (s: Selection) => void;
  reduced: boolean;
  /** Continuous rendering only while playing; on demand while paused. */
  playing: boolean;
  motion: MotionApi;
  /** Story Mode chooses the rig per beat; Lab leaves it to the viewer. */
  rig?: Rig | undefined;
  hidden: boolean;
  onContextLost: () => void;
  onContextRestored: () => void;
};

const SHELL_RADIUS: Record<ShellLayer, number> = { app: 0.13, transport: 0.2, internet: 0.27, link: 0.34 };
const EXPLODE = 1.9;
const LAYER_NAME: Record<ShellLayer, string> = { app: 'Application', transport: 'Transport', internet: 'Internet', link: 'Link' };
const easeOut = gsap.parseEase(ease.out);
const easeInOut = gsap.parseEase('power2.inOut');
const ACK_KINDS = new Set(['ack', 'hs-ack', 'response-ack', 'ack-fin-client', 'ack-fin-server']);
const shellOpacity = (layer: ShellLayer) => (layer === 'app' ? 0.95 : 0.22);

/** Progress of the cue that belongs to the rendered step (1 when the clock is elsewhere or under Reduced motion). */
function cueProgress(m: MotionApi, step: number, reduced: boolean) {
  const pos = m.pos.current;
  if (reduced || pos.index !== step) return { p: 1, kind: pos.cue?.kind ?? null };
  return { p: pos.progress, kind: pos.cue?.kind ?? null };
}

const pointerOn = (e: ThreeEvent<PointerEvent>) => {
  e.stopPropagation();
  document.body.style.cursor = 'pointer';
};
const pointerOff = () => {
  document.body.style.cursor = '';
};

function useHover() {
  const [hover, setHover] = useState(false);
  return {
    hover,
    bind: {
      onPointerOver: (e: ThreeEvent<PointerEvent>) => {
        pointerOn(e);
        setHover(true);
      },
      onPointerOut: () => {
        pointerOff();
        setHover(false);
      },
    },
  };
}

function Device({ d, selected, onSelect }: { d: SceneDevice; selected: boolean; onSelect: (s: Selection) => void }) {
  const { hover, bind } = useHover();
  // Always mounted, toggled by visibility: drei's Outlines builds its geometry imperatively and does not dispose it on unmount.
  const outline = <Outlines visible={hover || selected} thickness={2.5} color={selected ? color.app : color.text} />;
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect({ kind: 'device', id: d.id });
  };
  return (
    <group position={d.position} userData={{ pj: { type: 'device', id: d.id, kind: d.kind, selected } }}>
      {d.kind === 'router' ? (
        // Original stylised router: hexagonal prism with an emissive band.
        <mesh name={`device-${d.id}`} onClick={click} {...bind} position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.55, 0.55, 0.5, 6]} />
          <meshStandardMaterial color={color.bg1} metalness={0.6} roughness={0.35} emissive={color.internet} emissiveIntensity={0.18} />
          {outline}
        </mesh>
      ) : (
        // Original stylised host terminal: a slab with a glowing screen on a short stand.
        <group>
          <mesh name={`device-${d.id}`} onClick={click} {...bind} position={[0, 0.45, 0]}>
            <boxGeometry args={[0.95, 0.62, 0.16]} />
            <meshStandardMaterial color={color.bg1} metalness={0.5} roughness={0.4} />
            {outline}
          </mesh>
          <mesh position={[0, 0.45, 0.085]}>
            <planeGeometry args={[0.8, 0.48]} />
            <meshStandardMaterial color={color.bg0} emissive={color.transport} emissiveIntensity={0.55} />
          </mesh>
          <mesh position={[0, 0.06, 0]}>
            <boxGeometry args={[0.5, 0.06, 0.32]} />
            <meshStandardMaterial color={color.bg1} metalness={0.5} roughness={0.5} />
          </mesh>
        </group>
      )}
    </group>
  );
}

function LinkView({ l }: { l: SceneLink }) {
  const key = l.points.flat().join(',');
  const curve = useMemo(() => new CatmullRomCurve3(l.points.map((p) => new Vector3(...p))), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const pts = useMemo(() => curve.getPoints(40), [curve]);
  return (
    <group userData={{ pj: { type: 'link', id: l.id, label: l.label, active: l.active } }}>
      <mesh>
        <tubeGeometry args={[curve, 40, 0.03, 8, false]} />
        <meshStandardMaterial color={color.bg1} emissive={l.active ? color.link : color.muted} emissiveIntensity={l.active ? 1.4 : 0.25} />
      </mesh>
      {/* Directional dashes: flow from a toward b; animated flow arrives with playback. */}
      <Line points={pts} color={l.active ? color.link : '#3D3D3D'} lineWidth={1.5} dashed dashSize={0.12} gapSize={0.1} position={[0, 0.07, 0]} />
    </group>
  );
}

const BITS = 24;
const tmpM = new Matrix4();
const tmpV = new Vector3();

/** Teaching view of serialization: one permanently mounted instanced mesh, hidden unless a frame is being serialized. */
function BitStream({ l, motion, step, reduced }: { l: SceneLink | null; motion: MotionApi; step: number; reduced: boolean }) {
  const mesh = useRef<InstancedMesh>(null);
  const curve = useRef<CatmullRomCurve3 | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const key = l ? l.points.flat().join(',') : '';
  const place = (shift: number) => {
    const m = mesh.current;
    const c = curve.current;
    if (!m || !c) return;
    for (let i = 0; i < BITS; i++) {
      c.getPoint(0.04 + (((i / BITS + shift) % 1) * 0.92), tmpV);
      m.setMatrixAt(i, tmpM.makeTranslation(tmpV.x, tmpV.y + 0.12 + (i % 2) * 0.05, tmpV.z));
    }
    m.instanceMatrix.needsUpdate = true;
  };
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    m.visible = Boolean(l);
    curve.current = l ? new CatmullRomCurve3(l.points.map((p) => new Vector3(...p))) : null;
    if (l) {
      place(0);
      m.computeBoundingSphere();
    }
    invalidate();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Bits flow along the link while the frame is serialized/propagating (presentation of the transmit cue).
  useFrame(() => {
    if (!curve.current || reduced) return;
    place(cueProgress(motion, step, reduced).p * 0.5);
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, BITS]} userData={{ pj: { type: 'bitstream', link: l?.id ?? null } }} visible={false}>
      <sphereGeometry args={[0.035, 8, 8]} />
      <meshStandardMaterial color={color.physical} emissive={color.physical} emissiveIntensity={2} toneMapped={false} />
    </instancedMesh>
  );
}

// Hue-free layer encoding on the shell silhouette: Transport = dashed ring, Link = double ring (camera-facing).
const ring = (r: number): Vec3[] => Array.from({ length: 65 }, (_, i) => [Math.cos((i / 64) * Math.PI * 2) * r, Math.sin((i / 64) * Math.PI * 2) * r, 0]);
const RING_OUTER = ring(1);
const RING_INNER = ring(0.93);
const noRaycast = () => null;

function Shell({ layer, present, label, exploded, reduced, fallback, selected, onSelect, motion, step, adding, releasing, ttlFlash, glitch, dropped }: {
  layer: ShellLayer; present: boolean; label: string; exploded: boolean; reduced: boolean; selected: boolean; onSelect: (s: Selection) => void;
  motion: MotionApi; step: number; adding: boolean; releasing: boolean; ttlFlash: boolean; glitch: boolean; dropped: boolean; fallback: boolean;
}) {
  const mesh = useRef<Mesh>(null);
  const mat = useRef<MeshPhysicalMaterial>(null);
  const rings = useRef<(Line2 | LineSegments2 | null)[]>([]);
  const { hover, bind } = useHover();
  const target = present ? shellOpacity(layer) : 0;
  const r = SHELL_RADIUS[layer] * (exploded ? EXPLODE : 1);
  const glow = layer === 'app' ? 2.2 : 0.6;

  // Wrap: 1.15 → 1 with opacity; unwrap: releases outward; router forward: Internet shell flashes (TTL n → n−1).
  // Pure function of the cue progress, so any scrub position renders identically.
  useFrame(() => {
    const m = mat.current;
    const o = mesh.current;
    if (!m || !o) return;
    const { p } = cueProgress(motion, step, reduced);
    const e = easeOut(p);
    let scale = r;
    let opacity = target;
    if (adding && present) {
      scale = r * (1.15 - 0.15 * e);
      opacity = target * e;
    } else if (releasing) {
      scale = r * (1 + 0.15 * e);
      opacity = shellOpacity(layer) * (1 - e);
    }
    // Drop: the capsule fades as it fractures (Reduced: dims at once). Corruption: ≤ 300 ms glitch (half of the 0.6 s cue).
    if (dropped) opacity *= reduced ? 0.3 : 1 - e;
    const jitter = glitch && !reduced && p < 0.5 ? Math.sin(p * 90 + SHELL_RADIUS[layer] * 50) * 0.04 : 0;
    o.position.set(jitter, -jitter * 0.6, 0);
    o.scale.setScalar(scale);
    m.opacity = opacity;
    for (const l of rings.current) if (l) l.material.opacity = Math.min(1, opacity * 3);
    m.emissiveIntensity = ttlFlash && layer === 'internet' ? glow + 1.8 * Math.sin(Math.PI * p) : glow;
    o.visible = opacity > 0.004;
  });

  return (
    <mesh
      ref={mesh}
      name={`shell-${layer}`}
      scale={r}
      renderOrder={4 - SHELL_ORDER.indexOf(layer)}
      userData={{ pj: { type: 'shell', layer, present, label, color: color[layer] } }}
      onClick={(e) => {
        if (!present) return;
        e.stopPropagation();
        // Nested shells: pick the innermost one the ray actually passes through (centre → Application, rim → Link).
        const hit = e.intersections
          .map((i) => pjOf(i.object))
          .filter((pj): pj is Pj => pj?.type === 'shell' && pj.present === true)
          .map((pj) => pj.layer as ShellLayer)
          .sort((x, y) => SHELL_RADIUS[x] - SHELL_RADIUS[y])[0];
        onSelect({ kind: 'layer', layer: hit ?? layer });
      }}
      {...(present ? bind : {})}
    >
      <sphereGeometry args={[1, 32, 24]} />
      {!fallback && !reduced && layer !== 'app'
        ? <MeshTransmissionMaterial ref={(value) => { mat.current = value instanceof MeshPhysicalMaterial ? value : null; }} color={color[layer]} chromaticAberration={0} samples={2} resolution={64}
            transmissionSampler thickness={0.2} roughness={layer === 'internet' ? 0.45 : 0.08} emissive={color[layer]} emissiveIntensity={0.6}
            transparent opacity={target} depthWrite={false} side={DoubleSide} />
        : <meshPhysicalMaterial ref={mat} color={color[layer]} metalness={0.08} roughness={0.25} transmission={layer === 'app' ? 0 : 0.7}
            emissive={color[layer]} emissiveIntensity={layer === 'app' ? 2.2 : 0.6} transparent opacity={target} depthWrite={false}
            side={DoubleSide} toneMapped={layer !== 'app'} />}
      <Outlines visible={present && (hover || selected)} thickness={2} color={selected ? color.text : color[layer]} />
      {(layer === 'transport' || layer === 'link') && (
        <Billboard>
          {(layer === 'link' ? [RING_OUTER, RING_INNER] : [RING_OUTER]).map((pts, i) => (
            <Line key={i} ref={(l) => { rings.current[i] = l; }} points={pts} color={color.text} lineWidth={1.4} transparent opacity={0}
              dashed={layer === 'transport'} dashSize={0.14} gapSize={0.1} raycast={noRaycast} />
          ))}
        </Billboard>
      )}
    </mesh>
  );
}

function Packet({ model, rig, reduced, fallback, selected, onSelect, motion }: {
  model: SceneModel; rig: Rig; reduced: boolean; fallback: boolean; selected: Selection; onSelect: (s: Selection) => void; motion: MotionApi;
}) {
  const p = model.packet;
  const exploded = rig === 'inspect';
  const present = new Set(p?.shells.map((s) => s.layer));
  const group = useRef<Object3D>(null);
  const link = model.links.find((l) => l.id === p?.onLink);
  const key = link ? link.points.flat().join(',') : '';
  const curve = useMemo(() => (link ? new CatmullRomCurve3(link.points.map((v) => new Vector3(...v))) : null), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const ack = ACK_KINDS.has(p?.kind ?? '');
  useFrame(() => {
    const g = group.current;
    if (!g || !p) return;
    const { p: prog, kind } = cueProgress(motion, model.step, reduced);
    if (curve && link && kind === 'transmit' && !reduced) {
      // Progress is linear in virtual time between send start and arrival (exact, from the engine's timing).
      const t = link.from === p.from ? prog : 1 - prog;
      curve.getPoint(t, tmpV);
      g.position.set(tmpV.x, tmpV.y + 0.75, tmpV.z);
    } else g.position.set(...p.position);
  });
  return (
    <group ref={group} position={p?.position ?? [0, -50, 0]} visible={Boolean(p)} scale={ack ? 0.62 : 1} userData={{ pj: { type: 'packet', id: p?.id ?? null, ack } }}>
      <Fracture active={Boolean(p?.dropped)} motion={motion} step={model.step} reduced={reduced} />
      {/* ACKs travel back as a smaller capsule with a distinct ring. */}
      <mesh visible={ack} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.42, 0.025, 8, 32]} />
        <meshStandardMaterial color={color.success} emissive={color.success} emissiveIntensity={1.4} />
      </mesh>
      {SHELL_ORDER.map((layer) => (
        <Shell
          key={layer}
          layer={layer}
          present={Boolean(p) && present.has(layer)}
          label={p?.shells.find((s) => s.layer === layer)?.label ?? ''}
          exploded={exploded}
          reduced={reduced}
          fallback={fallback}
          selected={selected.kind === 'layer' && selected.layer === layer}
          onSelect={onSelect}
          motion={motion}
          step={model.step}
          adding={p?.adding === layer}
          releasing={p?.releasing === layer}
          ttlFlash={Boolean(p?.ttlFlash)}
          glitch={Boolean(p?.glitch)}
          dropped={Boolean(p?.dropped)}
        />
      ))}
    </group>
  );
}

/** Places the camera for the chosen rig. Instant jumps: cue-driven moves are phase 09, and Reduced never moves the camera. */
type Move = { fromPos: Vector3; fromTarget: Vector3; toPos: Vector3; toTarget: Vector3; t0: number | null; dur: number };

function CameraRig({ rig, model, motion, reduced }: { rig: Rig; model: SceneModel; motion: MotionApi; reduced: boolean }) {
  const move = useRef<Move | null>(null);
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const n = model.devices.length;
  const p = model.packet?.position;
  const follow = rig !== 'overview' && p ? p.join(',') : '';
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const span = (n - 1) * 3.2 + 3.2; // + room for the end labels
    // Fit the whole topology horizontally (fov 40°), with a floor for wide screens.
    const dist = Math.max(5, span / (2 * Math.tan((20 * Math.PI) / 180) * Math.min(aspect, 2.2)));
    let pos: Vec3 = [0, dist * 0.42, dist];
    let target: Vec3 = [0, 0.3, 0];
    if (model.layout === 'column') {
      // Seen from above-front so the top→bottom stack fills a tall, narrow stage.
      const d = Math.max(6, (span * 1.08) / (2 * Math.tan((20 * Math.PI) / 180)));
      pos = [0.2, d * 0.92, d * 0.42 - 0.5];
      target = [0.2, 0, -0.5]; // nudged so the first device clears the camera bar
    }
    if (rig !== 'overview' && p) {
      // Aim a little right of the packet so its shell labels stay in frame.
      target = [p[0] + 0.9, p[1], p[2]];
      pos = rig === 'follow' ? [p[0] + 1.4, p[1] + 1.8, p[2] + 6] : [p[0] + 1.1, p[1] + 0.7, p[2] + 4.2];
    }
    if (rig === 'follow' && !reduced && controls) {
      // Eased dolly (0.6–1.2 s, wall clock; presentation only). Reduced motion never moves the camera.
      const toPos = new Vector3(...pos);
      move.current = {
        fromPos: camera.position.clone(), fromTarget: controls.target.clone(), toPos, toTarget: new Vector3(...target),
        t0: null, dur: Math.min(1.2, Math.max(0.6, 0.6 + camera.position.distanceTo(toPos) * 0.08)),
      };
      invalidate();
      return;
    }
    move.current = null;
    camera.position.set(...pos);
    if (controls) {
      controls.target.set(...target);
      controls.update();
    } else camera.lookAt(...target);
    invalidate();
  }, [rig, follow, n, model.layout, size.width, size.height, camera, controls, invalidate, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame(({ clock }) => {
    const mv = move.current;
    if (!mv || !controls) return;
    // Hold while text the user must read is appearing (type-on and header decode).
    const kind = motion.pos.current.cue?.kind;
    if (mv.t0 === null) {
      if (kind === 'typeOn' || kind === 'wrap') return;
      mv.t0 = clock.elapsedTime;
    }
    const k = easeInOut(Math.min(1, (clock.elapsedTime - mv.t0) / mv.dur));
    camera.position.lerpVectors(mv.fromPos, mv.toPos, k);
    controls.target.lerpVectors(mv.fromTarget, mv.toTarget, k);
    controls.update();
    if (k >= 1) move.current = null;
    else invalidate();
  });
  return null;
}

const SHARDS = 28;
const shardDirs = Array.from({ length: SHARDS }, (_, i) => {
  // Deterministic directions on a sphere (golden-angle spiral): same burst on every replay.
  const y = 1 - (2 * (i + 0.5)) / SHARDS;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.39996;
  return new Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
});

/** Drop: the capsule fractures into shards at the drop point (presentation only; Reduced: shards stay close and still). */
function Fracture({ active, motion, step, reduced }: { active: boolean; motion: MotionApi; step: number; reduced: boolean }) {
  const mesh = useRef<InstancedMesh>(null);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    m.visible = active;
    if (!active) return;
    const { p } = cueProgress(motion, step, reduced);
    const d = reduced ? 0.4 : 0.15 + 1.1 * easeOut(p);
    for (let i = 0; i < SHARDS; i++) {
      const v = shardDirs[i];
      if (v) m.setMatrixAt(i, tmpM.makeTranslation(v.x * d, v.y * d, v.z * d));
    }
    m.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, SHARDS]} visible={false} frustumCulled={false} userData={{ pj: { type: 'fracture' } }}>
      <tetrahedronGeometry args={[0.05]} />
      <meshStandardMaterial color={color.danger} emissive={color.danger} emissiveIntensity={1.6} toneMapped={false} />
    </instancedMesh>
  );
}

const RING_DOTS = 32;
/** Retransmission timer: dots around the sender, the lit share = remaining / total in virtual time (from the clock). */
function TimerRing({ device, timer, motion }: { device: SceneDevice; timer: { deadlineMs: number; totalMs: number } | null; motion: MotionApi }) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = mesh.current;
    if (!m) return;
    for (let i = 0; i < RING_DOTS; i++) {
      const a = (i / RING_DOTS) * Math.PI * 2;
      m.setMatrixAt(i, tmpM.makeTranslation(Math.sin(a) * 0.85, 0.02, Math.cos(a) * 0.85));
    }
    m.instanceMatrix.needsUpdate = true;
  }, []);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    m.visible = Boolean(timer);
    if (!timer) return;
    const remaining = Math.max(0, Math.min(timer.totalMs, timer.deadlineMs - motion.pos.current.vt));
    m.count = Math.ceil((RING_DOTS * remaining) / timer.totalMs);
  });
  return (
    <instancedMesh ref={mesh} position={device.position} args={[undefined, undefined, RING_DOTS]} visible={false} userData={{ pj: { type: 'rto-ring', device: device.id } }}>
      <sphereGeometry args={[0.04, 8, 8]} />
      <meshStandardMaterial color={color.link} emissive={color.link} emissiveIntensity={1.4} />
    </instancedMesh>
  );
}

/** Demand rendering: every clock change (seek, scrub, step) requests a frame, since cue progress lives in a ref. */
function ClockFrames({ motion }: { motion: MotionApi }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => motion.clock.subscribe(() => invalidate()), [motion, invalidate]);
  return null;
}

/** Disables postprocessing after the frame budget is repeatedly missed (only counts back-to-back frames). */
function BudgetWatch({ onMiss }: { onMiss: () => void }) {
  const misses = useRef(0);
  useFrame((_, dt) => {
    misses.current = budgetStep(misses.current, dt);
    if (misses.current > BUDGET_MISSES) onMiss();
  });
  return null;
}

// ---------- labels: plain DOM in the main React tree, positioned by projecting 3D anchors each rendered frame ----------
type Label = { key: string; pos: Vec3; className: string; content: ReactNode; text: string };

function labelsFor(model: SceneModel, rig: Rig, selDevice: string | null): Label[] {
  const out: Label[] = [];
  for (const d of model.devices) out.push({ key: `d-${d.id}`, pos: d.labelPos, className: 'label3d-device', content: d.label, text: d.label });
  for (const l of model.links) out.push({ key: `l-${l.id}`, pos: l.labelPos, className: 'label3d-link', content: l.label, text: l.label });
  for (const i of model.ifaces) out.push({ key: `i-${i.device}.${i.iface}`, pos: i.position, className: `label3d-iface${selDevice === i.device ? ' is-selected' : ''}`, content: i.label, text: i.label });
  if (model.notice) {
    const d = model.devices.find((x) => x.id === model.notice?.device);
    if (d) out.push({ key: 'notice', pos: [d.position[0], 2.35, d.position[2]], className: `label3d-notice label3d-${model.notice.tone}`, content: model.notice.text, text: model.notice.text });
  }
  for (const tm of model.timers) {
    const d = model.devices.find((x) => x.id === tm.device);
    const text = `RTO ${tm.totalMs} ms · deadline ${tm.deadlineMs} ms · simplified policy`;
    if (d) out.push({ key: `rto-${tm.device}`, pos: [d.position[0], -1.75, d.position[2]], className: 'label3d-rto', content: text, text });
  }
  const pk = model.packet;
  if (pk?.bitStream) {
    const m = model.links.find((l) => l.id === pk.onLink)?.points[1];
    if (m) out.push({ key: 'bits', pos: model.layout === 'row' ? [m[0], m[1] - 0.3, m[2]] : [m[0] + 0.9, m[1], m[2]], className: 'label3d-bits', content: 'bit stream · teaching view', text: 'bit stream · teaching view' });
  }
  if (pk) {
    const off = rig === 'inspect' ? 0.75 : 0.5;
    out.push({
      key: 'shells',
      pos: [pk.position[0] + off, pk.position[1] + 0.15, pk.position[2]],
      className: 'label3d-shells',
      text: pk.shells.map((s) => `${LAYER_NAME[s.layer]} ${s.label}`).join('\n'),
      content: (
        <ul data-testid="shell-labels">
          {pk.shells.map((s) => (
            <li key={s.layer} style={{ color: s.color }}>
              <strong>{LAYER_NAME[s.layer]}</strong> {s.label}
            </li>
          ))}
        </ul>
      ),
    });
  }
  return out;
}

const tmp = new Vector3();
/** Writes screen positions straight to the label elements: no React state, no per-frame allocation. */
function LabelProjector({ labels, layer }: { labels: Label[]; layer: RefObject<HTMLDivElement | null> }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  useFrame(() => {
    const root = layer.current;
    if (!root) return;
    for (const l of labels) {
      const el = root.querySelector<HTMLElement>(`[data-key="${l.key}"]`);
      if (!el) continue;
      tmp.set(...l.pos).project(camera);
      const x = ((tmp.x + 1) / 2) * size.width;
      const y = ((1 - tmp.y) / 2) * size.height;
      const shells = l.key === 'shells';
      const halfWidth = shells ? 0 : el.offsetWidth / 2;
      const minX = 8 + halfWidth;
      const maxX = Math.max(minX, size.width - 8 - (shells ? el.offsetWidth : halfWidth));
      const halfHeight = el.offsetHeight / 2;
      const px = Math.max(minX, Math.min(maxX, x));
      const py = Math.max(8 + halfHeight, Math.min(size.height - 8 - halfHeight, y));
      el.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(${shells ? '0' : '-50%'}, -50%)`;
      el.style.visibility = tmp.z < 1 ? 'visible' : 'hidden';
    }
  });
  return null;
}

type Pj = { type: string; [k: string]: unknown };
const pjOf = (o: Object3D) => (o.userData as { pj?: Pj }).pj;

/** Dev/test-only hook: reports what is actually mounted in the scene graph plus renderer memory. */
function TestHook({ model, rig, fx }: { model: SceneModel; rig: Rig; fx: boolean }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    debug.frames = (debug.frames ?? 0) + 1;
  });
  useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.MODE !== 'test') return;
    debug.scene = () => {
      const devices: Pj[] = [];
      const links: Pj[] = [];
      const shells: (Pj & { visible: boolean })[] = [];
      let bitStream = false;
      let step = -1;
      let packetPos: number[] = [];
      let fracture = false;
      const rings: { device: string; lit: number }[] = [];
      scene.traverse((o) => {
        const pj = pjOf(o);
        if (!pj) return;
        if (pj.type === 'step') step = pj.step as number;
        if (pj.type === 'device') devices.push(pj);
        if (pj.type === 'link') links.push(pj);
        if (pj.type === 'shell') {
          const mm = (o as Mesh).material as MeshStandardMaterial;
          shells.push({ ...pj, visible: o.visible, material: mm.constructor.name, opacity: Math.round(mm.opacity * 1e4) / 1e4, scale: Math.round(o.scale.x * 1e4) / 1e4 });
        }
        if (pj.type === 'packet') packetPos = o.getWorldPosition(new Vector3()).toArray().map((x) => Math.round(x * 1e4) / 1e4);
        if (pj.type === 'bitstream' && o.visible) bitStream = true;
        if (pj.type === 'fracture' && o.visible) fracture = true;
        if (pj.type === 'rto-ring' && o.visible) rings.push({ device: pj.device as string, lit: (o as InstancedMesh).count });
      });
      // Labels as rendered (projected DOM in the main tree), not a closure over the last model.
      const labels = Array.from(gl.domElement.closest('.stage3d')?.querySelectorAll('.labels3d .label3d') ?? [], (e) => e.textContent ?? '');
      return {
        template: model.template,
        layout: model.layout,
        /** Step committed to the scene graph (not the React prop), so tests wait for what is actually mounted. */
        step,
        devices,
        links,
        presentShells: shells.filter((s) => s.present).map((s) => ({ layer: s.layer, color: s.color, label: s.label })),
        shellVisuals: shells.map((s) => ({ layer: s.layer, material: s.material, visible: s.visible, opacity: s.opacity, scale: s.scale })),
        packetPos,
        fracture,
        rings,
        notice: model.notice,
        bitStream,
        labels,
        rig,
        postprocessing: fx,
      };
    };
    debug.renderInfo = () => ({ geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, calls: gl.info.render.calls });
    // Geometries referenced by the live scene graph (what should stay constant across resets).
    debug.sceneGeometries = () => {
      const ids = new Set<number>();
      scene.traverse((o) => {
        const g = (o as Partial<Mesh>).geometry;
        if (g) ids.add(g.id);
      });
      return ids.size;
    };
    // Page coordinates of a named object's centre, so tests can click real meshes.
    debug.screenOf = (name: string) => {
      const o = scene.getObjectByName(name);
      if (!o) return null;
      const v = o.getWorldPosition(new Vector3()).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    };
  }, [gl, scene, camera, model, rig, fx]);
  return null;
}

/** Procedural environment map (three's RoomEnvironment through PMREM): no downloaded HDRI; disposed on unmount. */
function ProceduralEnv() {
  const gl = useThree((s) => s.gl);
  const get = useThree((s) => s.get);
  useEffect(() => {
    const scene = get().scene;
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const rt = pmrem.fromScene(room, 0.04);
    scene.environment = rt.texture;
    scene.environmentIntensity = 0.35;
    room.dispose();
    pmrem.dispose();
    return () => {
      scene.environment = null;
      rt.dispose();
    };
  }, [gl, get]);
  return null;
}

/** Static scene parts, memoised so parent re-renders never rebuild the environment portal or composer passes. */
const Backdrop = memo(function Backdrop() {
  return (
    <>
        <color attach="background" args={[color.bg0]} />
        <fog attach="fog" args={[color.bg0, 10, 34]} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[4, 6, 5]} intensity={1.6} color={color.text} />
        <directionalLight position={[-5, 3, -6]} intensity={1.1} color={color.transport} />
        <ProceduralEnv />
        <gridHelper args={[80, 160, '#292929', '#1A1A1A']} position={[0, -0.01, 0]} />
    </>
  );
});

const Effects = memo(function Effects() {
  return (
          <EffectComposer multisampling={4}>
            <Bloom mipmapBlur luminanceThreshold={0.92} intensity={0.42} />
            <Vignette offset={0.3} darkness={0.55} />
          </EffectComposer>
  );
});

export default function JourneyStage3D(p: Props) {
  const [rig, setRig] = useState<Rig>(p.rig ?? 'overview');
  // Follow the story's rig when it changes (adjust-state-during-render); the viewer can still switch afterwards.
  const [storyRig, setStoryRig] = useState(p.rig);
  if (p.rig !== storyRig) {
    setStoryRig(p.rig);
    if (p.rig) setRig(p.rig);
  }
  const wrap = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setNarrow((e?.contentRect.width ?? 999) < 560));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const model = useMemo(() => (narrow ? columnLayout(p.model) : p.model), [narrow, p.model]);
  const [budgetMissed, setBudgetMissed] = useState(false);
  // R3F forces a context loss on its own canvas when the stage unmounts (tab/view switch, new message):
  // that is cleanup, not a GPU failure, so it must not flip the app into the 2D fallback.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.MODE !== 'test') return;
    debug.forceMaterialFallback = () => setBudgetMissed(true);
    debug.materialFallback = () => budgetMissed;
    return () => { delete debug.forceMaterialFallback; delete debug.materialFallback; };
  }, [budgetMissed]);
  const fx = !p.reduced && !budgetMissed;
  const selDevice = p.selected.kind === 'device' ? p.selected.id : null;
  const active = model.links.find((l) => l.id === model.packet?.onLink);

  const labels = useMemo(() => labelsFor(model, rig, selDevice), [model, rig, selDevice]);
  const labelLayer = useRef<HTMLDivElement>(null);
  useEffect(() => () => pointerOff(), []);

  return (
    <div className="stage3d" data-testid="stage-3d" data-layout={model.layout} data-rig={rig} ref={wrap}>
      <div className="stage3d-bar">
        <Segmented
          label="Camera"
          value={rig}
          onChange={setRig}
          options={[
            { value: 'overview', label: 'Overview' },
            { value: 'follow', label: 'Follow packet' },
            { value: 'inspect', label: 'Inspect layers' },
          ]}
        />
      </div>
      <span className="hud-label stage3d-fx" data-testid="fx-status">
        {fx ? 'White bloom + glass' : p.reduced ? 'Effects off · Reduced motion' : 'Physical glass · frame budget missed'}
      </span>
      {/* Not a live region: App's single announcer speaks once per event. */}
      <p className="sr-only" data-testid="stage-summary">
        {model.summary}
      </p>
      <div className="labels3d" ref={labelLayer} aria-hidden="true">
        {labels.map((l) => (
          <div key={l.key} data-key={l.key} className={`label3d ${l.className}`} style={{ visibility: 'hidden' }}>
            {l.content}
          </div>
        ))}
      </div>
      <Canvas
        frameloop={p.hidden ? 'never' : p.playing ? 'always' : 'demand'}
        dpr={[1, 2]}
        gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
        camera={{ position: [0, 4, 10], fov: 40, near: 0.1, far: 120 }}
        onPointerMissed={pointerOff}
        onCreated={({ gl }) => {
          const el = gl.domElement;
          el.setAttribute('role', 'img');
          el.setAttribute('aria-label', '3D journey stage. Every object here has a 2D equivalent in the journey map and inspector below.');
          el.addEventListener('webglcontextlost', (e) => {
            e.preventDefault(); // allows restoration
            if (!alive.current) return;
            debug.contextLost = true;
            p.onContextLost();
          });
          el.addEventListener('webglcontextrestored', () => {
            if (!alive.current) return;
            debug.contextLost = false;
            p.onContextRestored();
          });
          requestAnimationFrame(() => {
            debug.drawCalls = gl.info.render.calls;
            debug.stageReady = true;
          });
        }}
      >
        <Backdrop />

        {model.links.map((l) => (
          <LinkView key={l.id} l={l} />
        ))}
        {model.devices.map((d) => (
          <Device key={d.id} d={d} selected={selDevice === d.id} onSelect={p.onSelect} />
        ))}
        {/* All interface ports share one instanced mesh. */}
        <Instances limit={16}>
          <boxGeometry args={[0.1, 0.1, 0.1]} />
          <meshStandardMaterial color={color.bg1} emissive={color.link} emissiveIntensity={1.2} />
          {model.devices.flatMap((d) => d.ports.map((pt) => <Instance key={`${d.id}.${pt.iface}`} position={pt.position} />))}
        </Instances>
        <BitStream l={model.packet?.bitStream && active ? active : null} motion={p.motion} step={model.step} reduced={p.reduced} />
        {model.devices
          .filter((d) => d.kind === 'host')
          .map((d) => (
            <TimerRing key={d.id} device={d} timer={model.timers.find((x) => x.device === d.id) ?? null} motion={p.motion} />
          ))}
        <Packet model={model} rig={rig} reduced={p.reduced} fallback={budgetMissed} selected={p.selected} onSelect={p.onSelect} motion={p.motion} />

        <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={1.5} maxDistance={28} maxPolarAngle={Math.PI * 0.48} />
        <CameraRig rig={rig} model={model} motion={p.motion} reduced={p.reduced} />
        {fx && <Effects />}
        {fx && <BudgetWatch onMiss={() => setBudgetMissed(true)} />}
        <group userData={{ pj: { type: 'step', step: model.step } }} />
        <ClockFrames motion={p.motion} />
        <LabelProjector labels={labels} layer={labelLayer} />
        <TestHook model={model} rig={rig} fx={fx} />
      </Canvas>
    </div>
  );
}
