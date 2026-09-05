# Scene events

Use ordinary Svelte event attributes on meshes, models, groups, or scenes:

```svelte
<script lang="ts">
  let hovered = $state(false);
</script>

<group
  onpointerenter={() => hovered = true}
  onpointerleave={() => hovered = false}
  onclick={(event) => select(event.target)}
>
  <mesh>
    <boxGeometry />
    <standardMaterial color={hovered ? [1, 1, 1, 1] : [1, 0.2, 0.3, 1]} />
  </mesh>
</group>
```

`select` is an application callback. No IDs, event-forwarding wrappers, or hover
attachment are required. Components forward event props with ordinary prop
spreads onto the underlying scene node. Component boundaries do not add nodes
to the event path. The Svelte Motion example uses one group click handler for
2,000 cubes and an enter/leave pair for its three-part marker.

## Events and propagation

`click`, `pointerdown`, `pointerup`, `pointermove`, `dragstart`, `dragmove`, and
`dragend` bubble from the picked mesh/model through scene-node ancestors. A parent
handler makes eligible descendant geometry pickable, even without mesh listeners.
Picking still chooses the nearest eligible geometry for the event, not every hit
along the ray. Mesh `pointerEvents="none"`, `hitTest="none"`, and hierarchy
visibility continue to filter hits. Pointer opt-outs are local to meshes/models,
not inherited from groups. Group drag listeners do not inherit the group's drag
configuration: `drag` and `dragButton` still belong to the picked mesh/model.

`pointerenter` and `pointerleave` do not bubble. They describe each node's hover
boundary: enter ancestors before children, leave children before ancestors.
Moving between siblings does not leave/re-enter their common group. There is no
ambiguous `onhover` alias. `camerachange` stays local to its camera. Custom events
dispatched through the low-level API stay local unless `{ bubbles: true }` is set.
Capture handlers and automatic keyboard/focus routing are not implemented.

Handlers receive `TypeGpuNodeEvent`, not a DOM `PointerEvent`:

- `target` is the originally picked node for bubbling events. For enter/leave it
  is the node whose boundary changed.
- `currentTarget` is the node whose listener is running; it becomes `null` after
  dispatch. Save it synchronously if needed in asynchronous work.
- `relatedTarget` is the previous/next picked node for hover transitions, or null.
- `detail` contains the picked instance ID and, where available, world-space hit
  point. Drag events carry `TypeGpuDragEventDetail`.
- `originalEvent` is the browser's canvas event.
- `stopPropagation()` stops later ancestors; `stopImmediatePropagation()` also
  stops remaining listeners on the current node. Neither stops native canvas
  listeners or automatically cancels camera/drag gestures.
- `preventDefault()` forwards to the original event when cancelable;
  `defaultPrevented` reflects cancellation. This does not cancel scene bubbling.

One shared event follows a snapshotted ancestor path, so reparenting in a handler
does not change that dispatch. Handler exceptions propagate to the caller.

## Performance and lifecycle

Handler discovery happens when the interaction index is rebuilt, not every frame.
Descendants share inherited handler sets. Motion retains those sets and updates
only affected bounds and instance data. Hover ancestry is checked on pointer
input; path arrays are allocated only when the hovered target or ancestry changes.
There is no extra RAF loop or per-frame picking. Consequently a scene moving
beneath a stationary pointer is re-evaluated on the next pointer input.

Reactive handler props and keyed component moves follow Svelte's normal behavior.
Unmounted nodes are removed from picking; retained detached nodes can still hold
listeners, as DOM nodes can. Use attachment cleanup for subscriptions or external
resources your application owns. `onNodeEvent` remains available for those cases.

Tests cover compiled-Svelte event props, group boundaries, propagation controls,
listener changes, reparenting, and disposal. The real Tween/Spring cadence matrix
runs at synthetic 60/120/144 Hz with both callback orders, asserting targeted
uploads, shared interaction data, GPU resource reuse, and demand-mode idle.
