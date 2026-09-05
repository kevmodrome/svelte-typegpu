# Svelte language compatibility

This contract applies to the pinned custom-renderer preview, not to arbitrary
Svelte releases. We test compiled components against the actual host renderer.

| Feature | Current status |
| --- | --- |
| Reactive state, component props, `{#if}`, keyed `{#each}` | Supported and tested |
| DOM `Canvas` host | Reactive scene props, inherited context, SSR shell, and async startup/unmount cleanup tested |
| Consumer component types | Canvas props/callbacks/bindings checked; scene-element declarations deferred due to language-tools casing and action-target gaps |
| `{#snippet}` and `{@render}` | Supported, including attachment forwarding |
| `<svelte:element>` | Dynamic geometry/materials, prop spreads, events, attachment cleanup, and keyed identity tested |
| Component `$bindable` props and component `bind:this` | Supported and tested |
| Scene event attributes and `onclickcapture` | Capture/target/bubble ordering, group hover, double-click/context-menu/wheel, and propagation controls supported |
| `Tween` / `Spring` bound to transforms and material values | Supported; frame delivery tested at 60/120/144 Hz in both RAF callback orders |
| `{@attach}` | Supported on scene nodes, including reactive replacement and component prop spreads |
| `use:` | Supported for renderer-safe actions with update/destroy cleanup |
| Host-element bindings, including `<mesh bind:this>` | Rejected by the pinned upstream compiler |
| `transition:`, `in:`, `out:`, `animate:` on host nodes | Rejected by the pinned upstream compiler |
| `{#await}` | Pending/then/catch, replacement, stale results, and unmount cleanup tested |
| Cross-component context | Reactive context preserved through asynchronously mounted children |
| `getAbortSignal()` | Cancels component-owned model requests on derived replacement and unmount |
| `<svelte:boundary>` | Error/reset cleanup tested with an externally declared `failed` snippet passed as a prop; inline `failed` snippets crash the pinned compiler |
| Async expressions and boundary `pending` snippets | Gated: ready/update paths work, but the pinned preview throws after unmounting a pending boundary; tracked by an isolated reproducer |

DOM-oriented libraries are not automatically compatible. Scene nodes are not
HTMLElements and do not implement layout, CSS, Web Animations, or DOM event APIs.
Keep DOM controls in an ordinary Svelte component outside the scene.
Use [Canvas hosting](canvas-guide.md) to cross that boundary without manually
mounting, remounting, or disposing the scene.
See the [element typing investigation](scene-element-types-design.md) for the
reproducer and current editor limitations. These are separate from the tested
runtime attachment/action behavior below.

Async expressions (`await` in markup or `$derived`) are not enabled in the apps.
Their successful ready paths do not establish safe lifecycle behavior. See the
[async investigation](async-expressions-design.md) and the
[pending-boundary teardown reproducer](../packages/svelte-typegpu/repros/README.md).
Continue using ordinary `{#await}` for supported async scene composition.

## Dynamic primitives

Use `<svelte:element>` inside a stable mesh when the primitive type is dynamic.
It uses the existing renderer hooks; there is no extra renderer component or
per-frame traversal:

```svelte
<script>
  let { geometry = 'boxGeometry', material = 'standardMaterial', color } = $props();
</script>

<mesh onclick={() => console.log('selected')}>
  <svelte:element this={geometry} />
  <svelte:element this={material} {color} />
</mesh>
```

Changing a tag replaces only that primitive and runs its attachment cleanup.
The surrounding mesh keeps its identity and handlers. With an unchanged tag,
reactive props update the existing node. A `null` tag removes that subtree; a mesh
without geometry contributes no draw batch. Use valid scene primitive names,
including their casing, and pass only props appropriate to the chosen primitive.

An ordinary Svelte component can forward a dynamic tag and `{...props}` in the
same way. Keyed component moves preserve node identity and attachments.
Geometry/material type changes are structural and can create GPU resources;
animate transforms, color, and other values instead of switching types each frame.
Stable dynamic tags with real Tween/Spring values are tested at 60/120/144 Hz in
both callback orders, with targeted instance writes and no buffer, bind-group,
pipeline, or attachment recreation. Geometry replacement is tested for buffer
cleanup and bounded demand frames; manual mode never requests RAF.

Dynamic tags do not bypass the host-binding, transition, or editor limitations
listed above.

## Async scenes

Use ordinary promises and `{#await}` for loading, ready, and failure branches.
The loader produces reusable CPU assets; the model primitive never parses an
`asset` again. Keep the promise stable between requests:

```svelte
<script>
  import { getAbortSignal } from 'svelte';
  import { loadModel } from 'svelte-typegpu';
  let { src } = $props();
  const request = $derived(loadModel(src, { signal: getAbortSignal() }));
</script>

{#await request}
  <mesh><boxGeometry /><basicMaterial color={[0.4, 0.4, 0.4, 1]} /></mesh>
{:then asset}
  <model {asset} position={[-2, 0, 0]} />
  <model {asset} position={[2, 0, 0]} />
{:catch error}
  <mesh><boxGeometry /><basicMaterial color={[1, 0.1, 0.1, 1]} /></mesh>
{/await}
```

`loadModel` accepts a URL string or ArrayBuffer. It does not globally cache;
retain/share the promise or asset explicitly, and create a new promise to retry.
Treat assets as immutable. Each root owns its GPU resources and prunes geometry
when no mounted item uses it. `asset` takes precedence over `data`, then `src`.
The existing `<model src>` and `<model data>` convenience paths are unchanged.

Svelte ignores obsolete promise results, but does not cancel arbitrary shared
work. The signal above cancels fetch when the derived reruns or is destroyed.
OBJ/GLB parsing is synchronous and cannot be interrupted midway. Demand mode
returns to idle after settlement; manual mode still requires an explicit draw.

Declare a boundary failure snippet outside the boundary and pass `{failed}`:
the equivalent nested declaration currently crashes the pinned upstream compiler.
Boundaries catch Svelte rendering/effect errors, not arbitrary event-handler,
fetch, or GPU validation errors. Use `{#await ... :catch}` for loader failures.

```svelte
{#snippet failed(error, reset)}
  <mesh onclick={reset}><boxGeometry /><basicMaterial color={[1, 0, 0, 1]} /></mesh>
{/snippet}
<svelte:boundary {failed}>
  <SceneContent />
</svelte:boundary>
```

## Ordinary event attributes

Use normal Svelte event attributes for hover and clicks. No attachment is needed:

```svelte
<script lang="ts">
  let hovered = $state(false);
</script>

<mesh onpointerenter={() => hovered = true} onpointerleave={() => hovered = false}>
  <boxGeometry />
  <standardMaterial color={hovered ? [1, 1, 1, 1] : [1, 0.2, 0.3, 1]} />
</mesh>
```

There is no target ID or additional animation loop. The event changes Svelte
state, and the material binding uses the normal targeted upload path. A group can
own these handlers for its descendants. Moving between its meshes keeps the group
hovered. Use the explicit enter/leave pair, not `onhover`, which is not a supported
event. See [scene events](scene-events-guide.md) for propagation and picking rules.

## Attach reusable behavior

Attachments remain useful for reusable setup/cleanup that needs the scene node,
not as a requirement for event handling. An attachment receives the actual scene
node. Use `TypeGpuAttachment` and `onNodeEvent` from `svelte-typegpu`, and keep the
attachment function stable when setup need not change on every motion tick.

`onNodeEvent` returns an idempotent unsubscribe function. Each subscription owns
its listener, even when another attachment uses the same callback. The runtime
routes click, pointer down/up/move/enter/leave, and drag start/move/end events from
canvas picking. These are `TypeGpuNodeEvent` values, not DOM events; the original
browser event is available as `originalEvent`. The helper uses the same scene
propagation rules as event attributes; it does not add a separate event system.

Svelte runs attachment cleanup on reactive replacement or unmount. Keyed moves
preserve the attachment; `visible={false}` does not unmount it. Return cleanup for
every subscription you create. Unmount the Svelte component before disposing its
GPU root; `root.dispose()` alone does not own Svelte effects.

Prefer reactive props over mutating `node.attributes`, linked-list pointers, or
GPU descriptors directly. `TypeGpuNode` is exported for typing/debugging, not as
an alternative reactive store. `frameTask` remains the mechanism for per-frame
simulation; attachments should not introduce their own RAF loops.

Attachments on wrapper components are forwarded by spreading their props onto
the underlying primitive, using ordinary Svelte attachment syntax. See the
[Svelte attachment documentation](https://svelte.dev/docs/svelte/@attach) for
reactivity and composition semantics; the non-DOM target contract above is ours.
