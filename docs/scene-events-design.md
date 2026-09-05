# Composable scene events

## 1. Scope and risk

Let a scene/group component own interactions for descendant meshes without IDs
or per-mesh forwarding callbacks. High risk: picking eligibility, event ordering,
retained hover paths, and hot-path resource reuse. Preserve existing nearest-hit
picking, drag capture, and the single frame scheduler. No capture phase, DOM
event dispatch, keyboard routing, or ray propagation through occluding meshes.

## 2. Current program model

`scene-compiler.ts` builds interaction targets from listeners on each mesh only.
`core.ts` dispatches a fresh plain object separately to each target listener.
`svelte-renderer.ts` owns pointer/drag picking and one hovered mesh reference.
`SceneTransformCache` updates existing interaction bounds on motion-only frames.

```text
canvas input -> nearest eligible mesh -> own listeners only
listener mutation -> Dirty.Interaction -> interaction index rebuild
motion -> retained target bounds update (no listener discovery)
```

## 3. Proposed program shape

```text
+ src/node-events.ts + tests: event object, event-name sets, path dispatch
~ core.ts: retain re-exports; listeners use the shared event type
~ primitives.ts: group/scene pointer listener changes invalidate picking
~ scene-compiler.ts: memoized ancestor handler sets during index rebuild
~ svelte-renderer.ts: retained hover ancestry, enter/leave path differences
~ runtime/GPU/compiled-Svelte tests: interaction, lifecycle and cadence evidence
~ SvelteMotion example: one group click handler for the stationary field
```

The interaction rebuild shares inherited handler sets where a child has no own
listeners. Motion-only updates still reuse the index and sets. Listener-only
rebuilds reuse existing resource items instead of resetting the transform cache.
Dispatch snapshots the propagation path before invoking user code. One event
object per dispatch has prototype methods, not per-listener object/closure copies.

## 4. Contracts and invariants

- Click, pointer down/up/move, and drag start/move/end bubble through scene-node
  ancestry. Other events, including camerachange, remain local unless an explicit
  dispatch opts into bubbling. The picked mesh remains `target`; `currentTarget`
  is the current listener node and null outside dispatch.
- `stopPropagation` stops subsequent ancestors; `stopImmediatePropagation` also
  stops remaining listeners on that node. Neither stops native canvas listeners.
  `preventDefault` forwards to the original event when cancelable. Listener sets
  are snapshotted per node; removals apply immediately, additions wait until the
  next visit/dispatch. Errors continue to propagate to the caller.
- Pointer enter/leave do not bubble. The runtime dispatches them only on nodes
  actually entered/left, leaf-out then ancestor-in. Moving between siblings keeps
  common ancestors hovered. Hover updates remain input-driven, not a new per-frame
  raycast. Saved ancestry allows correct exit after reparenting/removal.
- A parent handler makes eligible visible descendant meshes pickable. Existing
  mesh pointerEvents/hitTest opt-outs remain local geometry filters. No new
  inherited pointerEvents policy is introduced.

## 5. Vertical slices and verification

1. Core event protocol: ordering, stop controls, original-event defaults, stable
   paths under reparent/unmount, nested dispatch, listener mutation, cleanup after
   exceptions. Commit the protocol and ancestor-aware picking once tested.
2. Hover ancestry and actual canvas interaction: sibling transitions, enter/exit,
   group-only listeners, reactive listener removal, drag capture/bubbling. Verify
   real compiled Svelte handlers, keyed movement, and retained attachments.
3. Replace the motion field's 2,000 forwarding handlers with one group handler.
   Test real Tween/Spring at 60/120/144 Hz in both callback orders, targeted uploads,
   unchanged interaction sets/buffers/pipelines, demand idle, and disposal. Verify
   desktop/mobile motion and clicks; commit example/docs separately.

## 6. Risks and alternatives

Per-child wrapper callbacks duplicate listeners and prevent reusable group-level
behavior. Rewalking ancestry during every motion frame would add avoidable work;
only full interaction rebuilds discover handlers. A global handler cache would
require separate structural/listener generations; rebuild-local memoization is
sufficient because the existing motion path already retains targets. Hover path
arrays grow with depth, not frame count, and are cleared on disposal. Compatibility
change: parents that previously received no descendant events now receive them;
use stopPropagation or direct target comparisons for local-only behavior.
