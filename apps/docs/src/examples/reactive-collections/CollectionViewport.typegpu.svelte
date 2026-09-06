<script lang="ts">
  import type { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import type { TypeGpuRoot, TypeGpuRootOptions } from 'svelte-typegpu';
  import type { CollectionObject } from './collection';

  let { objects, selected, frameloop = 'demand', maxDevicePixelRatio = 1.5,
    onready, onfps, onrenderererror }: {
    objects: SvelteMap<number, CollectionObject>;
    selected: SvelteSet<number>;
    frameloop?: TypeGpuRootOptions['frameloop'];
    maxDevicePixelRatio?: number;
    onready?: (root: TypeGpuRoot) => void;
    onfps?: (fps: number) => void;
    onrenderererror?: (error: unknown) => void;
  } = $props();
</script>

<canvas {frameloop} {maxDevicePixelRatio} {onready} {onfps} {onrenderererror}
  aria-label="Reactive Collections 3D scene" tabindex={0} aria-keyshortcuts="Escape"
  onpointerdown={(event) => event.currentTarget.focus({ preventScroll: true })}
  onkeydown={(event) => { if (event.key === 'Escape') selected.clear(); }}>
  <scene clearColor={[0.045, 0.05, 0.055, 1]}>
    <perspectiveCamera active position={[9, 9, 12]} target={[0, 0.5, 0]} fov={44}>
      <controls mode="orbit" minDistance={10} maxDistance={28}>
        <pointerControls dragButton="primary" wheel="zoom" />
      </controls>
    </perspectiveCamera>
    <ambientLight intensity={0.65} />
    <directionalLight position={[3, 8, 5]} intensity={1.1} />
    {#each Array.from({ length: 64 }, (_, i) => i) as i (i)}
      <mesh position={[i % 8 - 3.5, -0.1, Math.floor(i / 8) - 3.5]}
        scale={[0.96, 0.15, 0.96]} pointerEvents="none">
        <boxGeometry /><standardMaterial color={[0.19, 0.22, 0.23]} />
      </mesh>
    {/each}
    {#each objects.keys() as id (id)}
      {@const object = objects.get(id)!}
      <mesh name={`Box ${id + 1}`} position={[object.x, object.height / 2, object.z]}
        scale={[0.82, object.height, 0.82]}
        onclick={() => selected.has(id) ? selected.delete(id) : selected.add(id)}>
        <boxGeometry />
        <standardMaterial color={selected.has(id) ? [1, 0.8, 0.2] : object.color} roughness={0.4} />
      </mesh>
    {/each}
  </scene>
</canvas>
