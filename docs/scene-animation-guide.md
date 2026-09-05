# Animation and frame tasks

## Svelte motion and materials

Use ordinary reactive bindings on mesh/group transforms and material values.
`Tween.current` and `Spring.current` need no renderer-specific adapter.

```svelte
<mesh position={position.current}>
  <boxGeometry />
  <standardMaterial color={color.current} roughness={roughness.current} />
</mesh>
```

Transform and material-value updates touch affected instances. Geometry, shader,
texture, and pipeline changes still use full scene compilation. Crossing an
opaque/transparent boundary can change blend/depth/shadow state and is structural;
declare an appropriate `blendMode` and `depthWrite` when those should stay fixed.

Custom fragment functions continue to use TypeGPU and the exported
`materialBindGroupLayout`. For example:

```svelte
<shaderMaterial fragment={fragment} uniforms={{ value0: amount.current }} />
```

Reference the typed layout in TypeGPU functions; do not hard-code numeric bind
group indices. TypeGPU assigns dense indices for the layouts each shader uses.

The existing uniform layout has eight vec4 slots, `value0` through `value7`.
Scalars fill the first lane. Changing values writes the existing uniform buffer.
Each mounted shader material with authored `uniforms` owns its binding, so two
independently animated materials cannot overwrite each other. They may require
separate draw calls even when their current values match. Materials without
authored uniforms can share the default binding. No IDs are required.

## Dynamic collections

Use keyed `{#each}` blocks normally. Packed instance storage and GPU buffers grow
geometrically, retaining capacity when the active count shrinks. Appends within
capacity upload new slots, tail removals update the draw count without uploading,
and reordering updates affected slots. Spare slots are never drawn.

Removing every attached item in a batch releases its GPU resources; this is not
an unbounded pool. Hidden attached items retain reusable resources. Structural
changes still compile the scene, so this optimization reduces allocation/upload
cost rather than making arbitrary structural editing constant-time.

## Composable frame tasks

`frameTask` is a host primitive, like `mesh`. Wrap it in ordinary components to
build reusable behavior, keeping data connections in Svelte props and bindings.
The Gravity example uses this component:

```svelte
<!-- GravityFrameTask.typegpu.svelte -->
<script lang="ts">
  import type { TypeGpuFrameContext } from 'svelte-typegpu';
  import { stepGravity, type GravityBody } from './gravity-simulation';

  let { bodies = $bindable(), speed = 1, active = true }: {
    bodies: GravityBody[];
    speed?: number;
    active?: boolean;
  } = $props();

  function update({ delta }: TypeGpuFrameContext) {
    if (delta > 0) bodies = stepGravity(bodies, delta, speed);
  }
</script>

<frameTask {update} {active} />
```

The parent owns the bodies, independent of the scene hierarchy:

```svelte
<scene>
  <GravityFrameTask bind:bodies active={!paused} />
  {#each bodies as body (body.id)}
    <GravityBody {body} />
  {/each}
</scene>
```

Task attributes:

| Attribute | Default | Meaning |
| --- | --- | --- |
| `update` | none | Synchronous callback receiving one frame context |
| `active` | `true` | Enable or pause the task |
| `priority` | `0` | Lower priorities run first; tree order breaks ties |
| `continuous` | `true` | Keep a demand-mode root rendering while active |

`timestamp` uses browser milliseconds. `delta` and `elapsed` use seconds; delta
is zero on the first rendered frame and capped at 0.05 seconds thereafter.
Elapsed accumulates these capped deltas; it is simulation time, not wall time.
Inactive tasks receive no callbacks. A hidden ancestor also pauses its tasks.

The renderer runs the task snapshot, flushes Svelte state, synchronizes the scene,
then draws. Tasks added during that frame begin on the next frame. Do not use
async callbacks or start another RAF loop inside a task. Synchronous exceptions
surface and abort that frame; there is no automatic retry. Unmounting removes a
task, and disposing a root cancels its scheduled frame work.

Use `frameloop: 'demand'` to sleep when no continuous tasks or scene updates need
frames. Updates received while a frame is already queued retain one follow-up
frame, keeping external Svelte motion in step with the browser without an
unbounded idle loop. `continuous={false}` runs a task only on otherwise requested frames.
`frameloop: 'manual'` never schedules RAF; call `root.gpu.renderFrame(timestamp)`
to step explicitly. Built-in shader time requires `always` mode or an active
continuous task if it should advance while nothing else changes.
