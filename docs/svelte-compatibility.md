# Svelte language compatibility

This contract applies to the pinned custom-renderer preview, not to arbitrary
Svelte releases. We test compiled components against the actual host renderer.

| Feature | Current status |
| --- | --- |
| Reactive state, component props, `{#if}`, keyed `{#each}` | Supported and tested |
| Deep `$state` value props | Small vectors, colors, matrices, bounds, uniforms and material descriptors update through named props and spreads; bulk resource inputs remain reference-based |
| Store auto-subscriptions (`$store`) | Same-object vector updates, named props/spreads, writable event assignments, store replacement, shared derived producers and unsubscribe cleanup tested; real Tween/Spring-to-store cadence verified |
| `SvelteMap` / `SvelteSet` | Keyed objects and per-key selection, collection replacement, no-op edits, explicit deep-state values and cleanup tested; real Tween/Spring-to-map cadence verified |
| DOM `Canvas` host | Reactive scene/canvas props, native DOM events/attachments, inherited context, SSR shell, and async startup/unmount cleanup tested |
| Dedicated `<canvas>` viewport | Experimental compiler path: native attributes/events/attachments, `bind:this`, read-only size bindings, scoped CSS, SSR/hydration, scene switching and frame cadence tested; other canvas directives are explicitly rejected |
| `<svelte:window>`, `<svelte:document>`, `<svelte:body>` | Not supported in `.typegpu.svelte`; the pinned compiler rejects them under a custom renderer. Keep them in an ordinary DOM parent component |
| Reactive render settings | `frameloop` and `maxDevicePixelRatio` update in both canvas hosts without remounting; startup races, mode changes during real motion, resource reuse and manual/idle cancellation tested |
| Consumer component types | Canvas props/callbacks/bindings checked; scene-element declarations deferred due to language-tools casing and action-target gaps |
| Scene authoring diagnostics | Build-time warnings for unknown static primitives and definitely invalid resource/control parenting; components, snippets and dynamic tags retain composition flexibility |
| `{#snippet}` and `{@render}` | Supported, including attachment forwarding |
| `{#key}` | Subtree state resets, snippet/component composition, attachment cleanup, obsolete await results and retained canvas identity tested; real motion cadence and shared GPU resource reuse verified |
| `<svelte:element>` | Dynamic geometry/materials, prop spreads, events, attachment cleanup, and keyed identity tested |
| Component `$bindable` props and component `bind:this` | Supported and tested |
| Scene event attributes and `onclickcapture` | Capture/target/bubble ordering, group boundaries, bubbling pointerover/pointerout, double-click/context-menu/wheel, and propagation controls supported |
| `onpointercancel` | Original pressed-object routing, independent pointer IDs, capture/bubbling, callback replacement and terminal cleanup; no general scene pointer-capture API |
| `Tween` / `Spring` bound to transforms and material values | Supported; frame delivery tested at 60/120/144 Hz in both RAF callback orders |
| `MediaQuery` / `prefersReducedMotion` | Native subscription routing, shared listeners and teardown tested; the Svelte Motion example responds to preference changes without replaying settled targets |
| `{@attach}` | Supported on scene nodes, including reactive replacement and component prop spreads |
| Scene node references in `$state` | Identity preserved for attachment/event targets, including nested state objects and arrays; node internals remain renderer-owned |
| `use:` | Not part of the renderer API; use attachments. The pinned preview may accept scene actions incidentally; the canvas boundary rejects them |
| `class:` and `style:` | Not part of the scene API; use material/transform props, and ordinary class/style attributes on the native canvas |
| Host-element bindings, including `<mesh bind:this>` | Rejected by the pinned upstream compiler |
| `transition:`, `in:`, `out:`, `animate:` on host nodes | Rejected by the pinned upstream compiler |
| `{#await}` | Pending/then/catch, replacement, stale results, and unmount cleanup tested |
| Cross-component context | Reactive context preserved through asynchronously mounted children |
| `getAbortSignal()` | Cancels component-owned model requests on derived replacement and unmount |
| Conditional texture ownership | Removing the last textured node cancels pending root-owned loading; hidden nodes and other owners retain shared textures |
| Conditional model ownership | Removing the last implicit URL/data model owner releases its cache entry; pending URL fetches abort, hidden/shared owners retain them, and obsolete results cannot request frames |
| `<svelte:boundary>` | Error/reset cleanup tested with an externally declared `failed` snippet passed as a prop; inline `failed` snippets crash the pinned compiler |
| Async expressions and boundary `pending` snippets | Gated: ready/update paths work, but the pinned preview throws after unmounting a pending boundary; tracked by an isolated reproducer |

DOM-oriented libraries are not automatically compatible. Scene nodes are not
HTMLElements and do not implement layout, CSS, Web Animations, or DOM event APIs.
Keep DOM controls in an ordinary Svelte component outside the scene.
See [Declarative canvas viewports](declarative-canvas-guide.md) for the new
canvas-owned entry syntax. Its DOM canvas binding support does not enable
`bind:this` on custom scene primitives.
Use [Canvas hosting](canvas-guide.md) to cross that boundary without manually
mounting, remounting, or disposing the scene.
See the [global-element investigation](viewport-global-elements-design.md) for
the native initialization-order contract and why a canvas attachment is not an
equivalent implementation of `<svelte:window>`.
See the [element typing investigation](scene-element-types-design.md) for the
reproducer and current editor limitations. These are separate from the tested
runtime attachment behavior below.
See [scene diagnostics](scene-diagnostics-guide.md) for warning codes, static
analysis limits, and build-level filtering. These checks add no frame-loop work.

Async expressions (`await` in markup or `$derived`) are not enabled in the apps.
Their successful ready paths do not establish safe lifecycle behavior. See the
[async investigation](async-expressions-design.md) and the
[pending-boundary teardown reproducer](../packages/svelte-typegpu/repros/README.md).
Continue using ordinary `{#await}` for supported async scene composition.

## Mutable value props

Small structured scene values work with ordinary deep `$state` mutations. This
applies inside snippets, keyed lists and wrapper components as well as directly
on primitives:

```svelte
<script>
  const position = $state([0, 0, 0]);
  const rotation = $state({ x: 0, y: 0, z: 0 });
</script>

<mesh {position} {rotation} onclick={() => {
  position[0] += 1;
  rotation.y += Math.PI / 12;
}}>
  <boxGeometry /><standardMaterial color={[0.2, 0.7, 0.4]} />
</mesh>
```

The shared compiler integration (`typegpuSvelte` or `compileTypeGpu`) tracks the
small fields consumed by the renderer inside Svelte's existing attribute effects.
It keeps unchanged value snapshots stable and uses the ordinary targeted dirty
path when they change. There are no per-node observers or additional frame loops.
Inline tuples such as `position={[x.current, 0, 0]}` retain their existing fast path.

Supported shapes are transform/camera vectors, color tuples, quaternions, matrices,
`bounds.min/max`, shader `uniforms.time/resolution/value0..value7`, texture
descriptors (`map`/`texture`) and sampler descriptors. Array snapshots are bounded
to 32 entries; this is not general deep cloning of arbitrary scene data.
Native canvas and component props are left intact; a receiving scene primitive
adapts its own value props. Spreads preserve event and attachment identities.

Typed arrays, vertex/index buffers, loaded model assets, texture bytes and shader
functions remain opaque inputs. Typed-array writes are not reactive: replace the
input to request an update. Existing explicit resource keys still identify
immutable resource contents, so change the key when replacing keyed contents.
Node attribute snapshots are renderer-owned; mutate your state, not a retained
node's internals. Using only the raw upstream custom-renderer compiler does not
include this adaptation.

The Native Events example mutates `object.rotation[1]` from a mesh click handler.
Compiled Tween/Spring tests cover deep mutations through named props and spreads
at 60/120/144 Hz, both callback orders, demand/manual modes, exact upload ranges,
resource reuse, settled idling and disposal.

## Shared stores

Use ordinary Svelte stores to share state between DOM controls, scene components
and non-component producers. No renderer-specific store or attachment is needed:

```svelte
<script>
  let { position } = $props();
</script>

<mesh position={$position} onclick={() => $position[0] += 1}>
  <boxGeometry /><standardMaterial />
</mesh>
```

A DOM input can bind to the same writable store with
`bind:value={$position[0]}`. A `store.update` callback may mutate and return the
same small vector; the shared compiler snapshots its consumed values before
Svelte's attribute identity cache. A no-op notification does not dirty the scene.
Bulk typed arrays are still opaque resource inputs, not deeply observed buffers.

Svelte owns subscriptions: replacing a store prop releases the old subscription,
and unmounting a component unsubscribes its reads. Shared derived stores keep their
upstream subscription until their last subscriber leaves. Scope mutable stores to
the relevant app/component instance rather than sharing server state globally.

The [Shared Stores example](../apps/docs/src/examples/shared-stores/SharedStores.svelte)
contains the native editor and its dedicated GPU viewport as two ordinary consumer
files. Its sliders, selection checkbox, mesh click and canvas Escape handler all
use the same per-instance stores. The generated example is tested in demand and
manual modes, including exact upload ranges, resource reuse and canvas identity.

## Reactive collections

Use `SvelteMap` for a keyed object collection and `SvelteSet` for selection. Read
each value inside its keyed scope so an existing-key edit can remain local:

```svelte
<script>
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  const objects = new SvelteMap([[1, { position: [0, 1, 0] }]]);
  const selected = new SvelteSet();
</script>

<scene>
  {#each objects.keys() as id (id)}
    {@const object = objects.get(id)}
    <mesh position={object.position}
      onclick={() => selected.has(id) ? selected.delete(id) : selected.add(id)}>
      <boxGeometry />
      <standardMaterial color={selected.has(id) ? [1, 0.8, 0.2] : [0.2, 0.7, 0.5]} />
    </mesh>
  {/each}
</scene>
```

Map values are not automatically deeply reactive. Replace a plain record with
`objects.set(id, nextObject)`, or create the record with `$state` before adding it
to the map. Collection keys are ordinary application data, not renderer IDs.
Scope mutable collections to the app/component instance, not global server state.
Removing an object does not automatically remove its key from a separate selection
set; consumer commands own that policy.

Existing-key edits preserve mesh/attachment identity and instance storage, including
through child components. Same-value `set`, duplicate selection and absent-key
deletion do not dirty the scene. Structural add/delete/clear updates use normal
keyed Svelte reconciliation. Replacing the collection releases old subscriptions.
Real Tween/Spring updates through map entries are tested at 60/120/144 Hz in both
callback orders, with exact instance upload ranges, resource reuse, demand settling,
manual scheduling and disposal checks. No collection-specific renderer API or
animation loop is needed.

The [Reactive Collections example](../apps/docs/src/examples/reactive-collections/ReactiveCollections.svelte)
shares these collections between a DOM object list and a dedicated GPU viewport.
Height inputs replace individual records; checkboxes and mesh clicks update the
same selection set. Add/remove/reset commands reconcile keyed objects without
recreating the canvas. The example is bounded to 64 objects and defaults to demand
rendering.

## Media queries and reduced motion

Svelte's `MediaQuery.current` can drive ordinary scene props, including inside
snippets and child components. The renderer forwards subscriptions on native event
targets to those targets rather than treating them as scene nodes. Multiple reads
of a query share one listener; replacing it or removing its last consumer releases
that listener. Same-value notifications do not dirty the scene. This also supports
non-DOM subscriptions made through `svelte/events` in scene effects.

A MediaQuery observes browser media conditions, not the canvas's content dimensions.
Use native CSS for page layout and canvas size bindings for size-dependent scene
values. SSR only has the query's fallback, not the user's actual browser preference.
This does not enable `<svelte:window>` or turn scene nodes into DOM EventTargets.
DOM delegation-sensitive `svelte/events` subscriptions should remain in ordinary
DOM components: the pinned Svelte event wrapper skips DOM delegation in GPU scope.

The [Svelte Motion example](../apps/docs/src/examples/svelte-motion/SvelteMotion.typegpu.svelte)
reads the real `prefersReducedMotion` export from `svelte/motion`. When reduced
motion is enabled, it sets Tween values with `{ duration: 0 }` and Spring values
with `{ instant: true }`. This changes animation policy, not renderer frame rate:
interaction and demand/manual rendering continue to work normally.

When the preference switches off, compare the requested target with the existing
target before starting another animation. Read the existing target with `untrack`
so the effect does not subscribe to the target it writes. Otherwise a preference
change can start a full-duration no-op tween. The example keeps its existing
`onDestroy` cleanup for all producers.

The generated consumer example is tested with its two real Tweens, Spring, and
MediaQuery at 60/120/144 Hz in both RAF orders, initially normal/reduced modes,
mid-animation cancellation, future target changes, demand/manual rendering,
targeted instance writes, resource reuse and unmount cleanup. Active demand motion
drains its already-queued follow-up after cancellation, then idles; turning normal
motion back on with an unchanged target schedules nothing.

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

## Resetting scene state

Use `{#key}` when a change should recreate a subtree, including the local state of
its child components. For example, a DOM parent can increment `resetKey` to start
the scene content over without recreating the canvas or GPU root:

```svelte
<script>
  import SceneContent from './SceneContent.typegpu.svelte';
  let { resetKey = 0 } = $props();
</script>

<canvas>
  {#key resetKey}
    <SceneContent />
  {/key}
</canvas>
```

Changing the key destroys the old block, runs its attachment cleanup, and mounts
new content. State declared in the viewport's own script is outside the block and
does not reset. An unchanged key retains child state, nodes and attachments.
Obsolete `{#await}` results cannot bring the removed branch back.

Keyed `{#each}` serves a different purpose: it preserves individual items when a
collection is reordered. Use reactive transform/material props for animation;
changing a `{#key}` expression is intentionally structural work. Shared geometry,
materials and pipelines can remain cached when their resource keys remain live,
but a reset is not a promise of allocation-free remounting.

Tests cover real Tween/Spring motion before and after resets at 60/120/144 Hz,
both RAF orders, targeted writes, shared resource reuse, demand idling, manual
rendering and disposal. Key blocks do not enable unsupported host transitions.

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

## Conditional models

Ordinary scene control flow owns implicit model loading:

```svelte
{#if shown}
  <model src={modelUrl}>
    <standardMaterial color={[0.2, 0.7, 0.5]} />
  </model>
{/if}
```

Models sharing a URL use one request per root. Removing the last owner cancels a
pending fetch and releases the URL cache entry during scene synchronization.
Changing `src` releases the previous source when no other node uses it. Hidden
attached models retain ownership; `visible={false}` is not an unmount. Moving or
removing/reinserting a node before synchronization does not restart its request.

Ready and failed implicit entries are also released after their last owner leaves.
After that absence is synchronized, mounting the URL again starts a fresh request,
including retrying a failed source. An immediate same-URL keyed replacement still
shares the retained entry. Data-backed models similarly release their parsed cache entries;
synchronous parsing cannot be interrupted midway. An explicit `asset` or `data`
takes precedence over `src` and therefore does not retain an unused URL request.

Keep a `loadModel()` promise/result in caller-owned state to deliberately retain
and share CPU assets across unmounts. Removing `<model asset={asset}>` does not
cancel the caller's promise or invalidate their asset. Use `getAbortSignal()` for
component-owned explicit requests as described above.

Root disposal cancels pending implicit URL loads. Obsolete success/failure results
cannot replace newer same-source entries, publish geometry or request a late
frame. Ownership uses the existing structural scene walk, not a new per-frame
traversal. Compiled tests verify demand/manual behavior, shared GPU geometry,
96-byte targeted instance updates and real Tween/Spring cadence at 60/120/144 Hz
in both callback orders during model cancellation and remounting.

## Conditional textures

Ordinary control flow owns texture resources as well as geometry:

```svelte
{#if show}
  <mesh>
    <boxGeometry />
    <standardMaterial map={imageUrl} />
  </mesh>
{/if}
```

When scene synchronization removes the last owner of a texture key, the renderer
aborts its pending fetch. Changing `imageUrl` releases the previous key when no
other node uses it. Hidden attached nodes still own their resources; `visible`
is not an unmount. Shared keys issue one request per GPU root, and re-adding a
removed key starts a fresh load. Explicit resource keys still identify immutable
contents, so replacing keyed contents requires a new key.

Cancellation skips obsolete decoding stages and prevents late uploads or frame
requests. A bitmap decode already in progress cannot be interrupted, but its late
result is closed rather than uploaded. HTML fallback releases its object URL and
image source without waiting for decoding to settle. Root disposal also cancels
pending loads. No attachment, AbortController or extra animation loop is needed
in the component.

Live loads keep the existing white fallback until ready (or on failure). A ready
texture refreshes its material binding, reusing the existing uniform buffer and
its current shader values. Demand rendering wakes for settlement and then idles;
manual rendering still requires an explicit draw. This implicit resource path is
separate from promise-driven `{#await}` model loading above.

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

### Retaining a node reference

When an integration needs a reference, an attachment can retain the actual node
in ordinary `$state`. Nodes are opaque host objects: Svelte does not deep-proxy
them, even inside a reactive array or object. Identity comparisons with event
targets and identity-based cleanup therefore work normally:

```svelte
<script lang="ts">
  import type { TypeGpuAttachment, TypeGpuNode } from 'svelte-typegpu';
  let reference = $state<TypeGpuNode | null>(null);
  let selected = $state<TypeGpuNode | null>(null);
  const remember: TypeGpuAttachment = (node) => {
    reference = node;
    return () => {
      if (reference === node) reference = null;
      if (selected === node) selected = null;
    };
  };
</script>

<mesh {@attach remember} onclick={(event) => selected = event.currentTarget}>
  <boxGeometry />
  <basicMaterial color={selected && selected === reference ? [1, 0.3, 0.2] : [0.2, 0.7, 0.5]} />
</mesh>
```

Assigning a different reference is reactive. Reading a node's `attributes`,
parent, or children does not subscribe to renderer mutations. Continue expressing
scene changes through Svelte state and primitive props; do not use retained
references as a second scene-state API. `children` returns a fresh snapshot when
read; spreading or serializing a host object is not a supported tree-copy API.
`<mesh bind:this>` remains unsupported by the pinned compiler.

Attachments on wrapper components are forwarded by spreading their props onto
the underlying primitive, using ordinary Svelte attachment syntax. See the
[Svelte attachment documentation](https://svelte.dev/docs/svelte/@attach) for
reactivity and composition semantics; the non-DOM target contract above is ours.
