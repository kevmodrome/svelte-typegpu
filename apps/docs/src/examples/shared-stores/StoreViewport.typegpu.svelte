<script lang="ts">
  import type { Writable } from 'svelte/store';
  import type { TypeGpuRoot, TypeGpuRootOptions, Vector3Tuple } from 'svelte-typegpu';

  let { position, rotation, selected, frameloop = 'demand', maxDevicePixelRatio = 1.5,
    onready, onfps, onrenderererror }: {
    position: Writable<Vector3Tuple>;
    rotation: Writable<number>;
    selected: Writable<boolean>;
    frameloop?: TypeGpuRootOptions['frameloop'];
    maxDevicePixelRatio?: number;
    onready?: (root: TypeGpuRoot) => void;
    onfps?: (fps: number) => void;
    onrenderererror?: (error: unknown) => void;
  } = $props();
</script>

<canvas {frameloop} {maxDevicePixelRatio} {onready} {onfps} {onrenderererror}
  aria-label="Shared Stores 3D scene" tabindex={0} aria-keyshortcuts="Escape"
  onpointerdown={(event) => event.currentTarget.focus({ preventScroll: true })}
  onkeydown={(event) => { if (event.key === 'Escape') $selected = false; }}>
  <scene clearColor={[0.045, 0.05, 0.055, 1]}>
    <perspectiveCamera active position={[7, 6, 10]} target={[0, 0.5, 0]} fov={44}>
      <controls mode="orbit" minDistance={8} maxDistance={24}>
        <pointerControls dragButton="primary" wheel="zoom" />
      </controls>
    </perspectiveCamera>
    <ambientLight intensity={0.65} />
    <directionalLight position={[3, 8, 5]} intensity={1.1} />
    {#each Array.from({ length: 63 }, (_, i) => i) as i (i)}
      <mesh position={[i % 9 - 4, -0.1, Math.floor(i / 9) - 3]}
        scale={[0.96, 0.15, 0.96]} pointerEvents="none">
        <boxGeometry /><standardMaterial color={[0.19, 0.22, 0.23]} />
      </mesh>
    {/each}
    <mesh position={$position} rotation={[0, $rotation, 0]} scale={1.6}
      onclick={() => $selected = !$selected}>
      <boxGeometry />
      <standardMaterial color={$selected ? [1, 0.8, 0.2] : [0.2, 0.78, 0.56]} roughness={0.4} />
    </mesh>
  </scene>
</canvas>
