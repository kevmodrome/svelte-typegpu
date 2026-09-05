<script lang="ts">
  import type { Vector3Tuple } from 'svelte-typegpu';

  let { onready, onfps, onrenderererror, frameloop = 'demand' } = $props();

  let objects = $state([
    { name: 'Coral', color: [0.94, 0.24, 0.2] as Vector3Tuple, x: -2.8, angle: 0, size: 1 },
    { name: 'Jade', color: [0.15, 0.76, 0.46] as Vector3Tuple, x: 0, angle: 0, size: 1 },
    { name: 'Cobalt', color: [0.22, 0.48, 0.96] as Vector3Tuple, x: 2.8, angle: 0, size: 1 }
  ]);
  let selected = $state(0);
  let hovered = $state<number | null>(null);

  function reset(object: { angle: number; size: number }) {
    object.angle = 0;
    object.size = 1;
  }
</script>

<canvas
  {frameloop}
  {onready}
  {onfps}
  {onrenderererror}
  aria-label="Native Events 3D scene"
  aria-keyshortcuts="Escape"
  tabindex={0}
  onpointerdown={(event) => event.currentTarget.focus({ preventScroll: true })}
  onkeydown={(event) => { if (event.key === 'Escape') objects.forEach(reset); }}
>
  <scene clearColor={[0.035, 0.045, 0.05, 1]}>
    <perspectiveCamera active position={[7, 6, 12]} target={[0, 0.5, 0]} fov={42}>
      <controls mode="orbit" minDistance={9} maxDistance={24}>
        <pointerControls dragButton="primary" wheel="zoom" />
      </controls>
    </perspectiveCamera>
    <ambientLight intensity={0.65} />
    <directionalLight position={[3, 9, 6]} intensity={1.1} />
    <mesh position={[0, -0.35, 0]} scale={[10, 0.25, 4]} pointerEvents="none">
      <boxGeometry /><standardMaterial color={[0.17, 0.2, 0.23]} />
    </mesh>
    {#each objects as object, index (object.name)}
      <mesh
        position={[object.x, object.size * 0.75 - 0.15, 0]}
        rotation={[0, object.angle * Math.PI / 180, 0]}
        scale={[object.size * 1.5, object.size * 1.5, object.size * 1.5]}
        onpointerenter={() => hovered = index}
        onpointerleave={() => hovered = null}
        onclick={() => {
          selected = index;
          object.angle = (object.angle + 15) % 360;
        }}
        ondblclick={() => reset(object)}
        oncontextmenu={(event) => {
          event.preventDefault();
          reset(object);
        }}
        onwheel={(event) => {
          event.preventDefault();
          const wheel = event.originalEvent as WheelEvent;
          const pixels = wheel.deltaY * (wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? 400 : 1);
          object.size = Math.max(0.6, Math.min(1.6, object.size - pixels * 0.002));
        }}
      >
        <boxGeometry />
        <standardMaterial color={hovered === index ? [1, 0.85, 0.4] : object.color} />
      </mesh>
    {/each}
    <mesh position={[objects[selected].x, -0.12, 0]} scale={[1.9, 0.12, 1.9]} pointerEvents="none">
      <boxGeometry /><basicMaterial color={objects[selected].color} />
    </mesh>
  </scene>
</canvas>
