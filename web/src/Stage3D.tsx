import { Canvas } from '@react-three/fiber';
import { debug } from './debug.ts';
import { color } from './tokens.ts';

// Lazy chunk. Renders snapshot-driven content only; phase 00 shows a single smoke mesh.
export default function Stage3D({ onContextLost }: { onContextLost: () => void }) {
  return (
    <Canvas
      data-testid="stage-3d"
      frameloop="demand" // ponytail: nothing animates in 3D yet, so demand rendering also covers hidden-tab pausing
      dpr={[1, 2]}
      camera={{ position: [0, 0, 4], fov: 45 }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          debug.contextLost = true;
          onContextLost();
        });
        requestAnimationFrame(() => {
          debug.drawCalls = gl.info.render.calls;
          debug.stageReady = true;
        });
      }}
    >
      <ambientLight intensity={0.4} />
      <pointLight position={[3, 3, 3]} intensity={40} color={color.transport} />
      <mesh rotation={[0.5, 0.6, 0]}>
        <icosahedronGeometry args={[1.1, 0]} />
        <meshStandardMaterial color={color.bg1} emissive={color.transport} emissiveIntensity={0.35} flatShading />
      </mesh>
    </Canvas>
  );
}
