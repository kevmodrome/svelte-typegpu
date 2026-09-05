<script lang="ts">
  import type { TypeGpuNodeEvent } from 'svelte-typegpu';
  import type { NativeEventsProps } from './event-objects';

  let { objects, selected, bubbleClicks, onselect, onresize, onreset, onhover, onevent, onpath }:
    NativeEventsProps = $props();
  let hovered = $state<number | null>(null);

  function hover(index: number | null) {
    hovered = index;
    onhover(index === null ? null : objects[index].name);
  }

  function select(event: TypeGpuNodeEvent, index: number) {
    onselect(index);
    onevent(`click / ${objects[index].name}`);
    onpath('mesh');
    if (!bubbleClicks) event.stopPropagation();
  }

  function resize(event: TypeGpuNodeEvent, index: number) {
    event.preventDefault();
    const wheel = event.originalEvent as WheelEvent;
    const pixels = wheel.deltaY * (wheel.deltaMode === 1 ? 16 : wheel.deltaMode === 2 ? 400 : 1);
    onresize(index, -pixels * 0.002);
    onevent(`wheel / ${objects[index].name}`);
  }

  function reset(event: TypeGpuNodeEvent, index: number) {
    event.preventDefault();
    onreset(index);
    onevent(`${event.type} / ${objects[index].name}`);
  }
</script>

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
  <group
    onclickcapture={() => onpath('group capture', true)}
    onclick={() => onpath('group bubble')}
  >
    {#each objects as object, index (object.name)}
      <mesh
        position={[object.x, object.size * 0.75 - 0.15, 0]}
        rotation={[0, object.angle * Math.PI / 180, 0]}
        scale={[object.size * 1.5, object.size * 1.5, object.size * 1.5]}
        onpointerenter={() => hover(index)}
        onpointerleave={() => hover(null)}
        onclick={(event) => select(event, index)}
        ondblclick={(event) => reset(event, index)}
        oncontextmenu={(event) => reset(event, index)}
        onwheel={(event) => resize(event, index)}
      >
        <boxGeometry />
        <standardMaterial color={hovered === index ? [1, 0.85, 0.4] : object.color} />
      </mesh>
    {/each}
  </group>
  <mesh position={[objects[selected].x, -0.12, 0]} scale={[1.9, 0.12, 1.9]} pointerEvents="none">
    <boxGeometry /><basicMaterial color={objects[selected].color} />
  </mesh>
</scene>
