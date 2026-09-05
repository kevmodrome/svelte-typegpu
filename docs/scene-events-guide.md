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

`click`, `dblclick`, `contextmenu`, `wheel`, `pointerdown`, `pointerup`, `pointermove`,
`pointerover`, `pointerout`, `pointercancel`,
`dragstart`, `dragmove`, and `dragend` bubble from the picked mesh/model through scene-node ancestors. A parent
handler makes eligible descendant geometry pickable, even without mesh listeners.
Picking still chooses the nearest eligible geometry for the event, not every hit
along the ray. Mesh `pointerEvents="none"`, `hitTest="none"`, and hierarchy
visibility continue to filter hits. Pointer opt-outs are local to meshes/models,
not inherited from groups. Group drag listeners do not inherit the group's drag
configuration: `drag` and `dragButton` still belong to the picked mesh/model.

Use `ondblclick` for a native double-click and `oncontextmenu` for a context-menu
request at the pointer. A double-click still produces the browser's ordinary
click events; the renderer does not delay clicks or synthesize a timer. Call
`event.preventDefault()` in a context-menu handler to suppress the native menu
when the input is cancelable. The original button/modifier values remain on
`originalEvent`. Keyboard-triggered context menus do not have scene focus routing.

`pointerenter` and `pointerleave` do not bubble. They describe each node's hover
boundary: enter ancestors before children, leave children before ancestors.
Moving between siblings does not leave/re-enter their common group. There is no
ambiguous `onhover` alias.

Use `onpointerover` and `onpointerout` when a parent needs to observe each picked
child change instead of just the group's outer boundary:

```svelte
<group
  onpointerover={(event) => inspect(event.target)}
  onpointerout={(event) => inspect(event.relatedTarget)}
>
  {@render children()}
</group>
```

Here `inspect` is an application callback and `children` is a scene snippet.
Over/out bubble from the picked mesh/model, including between siblings. The order
is old target out, exited boundaries leave, new target over, then entered
boundaries enter. Stopping one event's propagation does not cancel the remaining
boundary events. Repeated input over the same target and ancestry emits no new
over/out. Native canvas entry also establishes hover before the next pointermove.
Canvas exit clears the previous target rather than picking at exit coordinates.
Reparenting/removal exits through the saved ancestry on the next pointer input;
moving between a model's primitive instances retains distinct instance IDs even
when `target` and `relatedTarget` are the same model node.

This distinction follows [Pointer Events boundary semantics](https://www.w3.org/TR/pointerevents3/#the-pointerenter-event),
but scene hover remains input-driven, not a complete DOM layout or multi-pointer
capture model. Object dragging retains its existing hover suppression.

`camerachange` and custom events dispatched through the
low-level API do not bubble unless `{ bubbles: true }` is set. Automatic
keyboard/focus routing is not implemented.

Use Svelte's capture suffix when a parent must observe an event before children:

```svelte
<group onclickcapture={inspectBeforeChildren} onclick={afterChildren}>
  <mesh onclick={select}><boxGeometry /></mesh>
</group>
```

Capture runs from scene ancestors toward the picked node, followed by target
listeners, then bubbling back outward. Capture listeners can also observe
non-bubbling events such as `pointerenter`; unlike a normal group enter handler,
`onpointerentercapture` observes descendant boundary changes too. The syntax is
the same as [Svelte's capture event attributes](https://svelte.dev/docs/svelte/v5-migration-guide#Event-changes-Event-modifiers).
For an attachment subscription, pass `{ capture: true }` as the fourth argument
to `onNodeEvent`. Its unsubscribe function retains the original capture flag.
Only `capture` is supported in listener options, not DOM once/passive/signal options.

## Interrupted presses

Use `onpointercancel` to reset state when the browser interrupts a pointer sequence:

```svelte
<script>
  let pressed = $state(false);
</script>

<mesh
  onpointerdown={() => pressed = true}
  onpointerup={() => pressed = false}
  onpointerleave={() => pressed = false}
  onpointercancel={() => pressed = false}
>
  <boxGeometry />
  <standardMaterial color={pressed ? [1, 0.6, 0.2] : [0.3, 0.7, 0.5]} />
</mesh>
```

Register cancellation handlers before the press. The runtime retains one eligible
hit per native pointer ID; cancellation goes to that original object even when
its geometry moves or the input's coordinates are elsewhere. A registered
pointerdown recipient takes precedence; without one, a cancellation-only handler
can make geometry eligible. A down recipient without cancellation handlers does
not redirect cancellation to another object behind it. An object drag that captures
the pointer owns cancellation when that dragged object has a handler.

Cancellation supports normal capture and bubbling through the node's current
ancestry, including callback replacement during the press. `detail` carries the
original instance ID and down hit point; current native coordinates and pointer ID
remain on `originalEvent`. It is non-cancelable and does not synthesize pointerup
or a click. This follows the [native pointercancel contract](https://www.w3.org/TR/pointerevents3/#the-pointercancel-event).

Up/cancel on either canvas or window releases the tracked sequence. Removing,
hiding or opting out the geometry, removing the cancellation registration, lost
capture and root disposal release tracking without synthesizing cancellation.
Lost capture still ends an object drag with `detail.cancelled = true`; it is not
reported as a fabricated native pointercancel. An actual cancellation emits
pointercancel before cancelled dragend. Ownership and native drag capture are
released before terminal callbacks, so reentrancy and disposal cannot leave an
old drag active. Disposal suppresses any remaining runtime notifications.

This is not general pointer capture: ordinary pointerup still uses picking, and
the example also clears pressed appearance when leaving the object. Tracking
starts only for registered cancellation handlers, and temporary window listeners
are shared with active object drags. Membership cleanup runs only when the
interaction index changes, not on every motion update or frame.

## Event object

Handlers receive `TypeGpuNodeEvent`, not a DOM `PointerEvent`:

- `target` is the originally picked node for bubbling events. For enter/leave it
  is the node whose boundary changed.
- `currentTarget` is the node whose listener is running; it becomes `null` after
  dispatch. Save it synchronously if needed in asynchronous work.
- An ordinary function handler's `this` is the same scene node as `currentTarget`.
  Arrow functions retain their lexical `this`. Use `TypeGpuNodeEventHandler` to
  type reusable callbacks, including their scene-node receiver.
- `eventPhase` is 1 for ancestor capture, 2 at the target (capture and ordinary
  listeners), 3 for ancestor bubbling, and 0 after dispatch.
- `relatedTarget` is the previous/next picked node for hover transitions, or null.
- `detail` contains the picked instance ID and, where available, world-space hit
  point. Drag events carry `TypeGpuDragEventDetail`.
- `originalEvent` is the browser's canvas event.
- `stopPropagation()` completes the current node/phase, then stops later visits.
  In target capture it also prevents the later target bubble pass.
  `stopImmediatePropagation()` also stops remaining listeners in the current pass.
  Neither stops native canvas
  listeners or automatically cancels camera/drag gestures.
- `preventDefault()` forwards to the original event when cancelable;
  `defaultPrevented` reflects cancellation. This does not cancel scene bubbling.

One shared event follows a snapshotted ancestor path, so reparenting in a handler
does not change that dispatch. Handler exceptions propagate to the caller.

## Wheel interaction

Use `onwheel` to manipulate a picked object and `ondblclick` to reset it:

```svelte
<script lang="ts">
  import type { TypeGpuNodeEvent } from 'svelte-typegpu';
  let size = $state(1);

  function resize(event: TypeGpuNodeEvent) {
    const input = event.originalEvent as WheelEvent;
    if (!input.deltaY) return;
    event.preventDefault();
    size = Math.max(0.25, Math.min(4, size - Math.sign(input.deltaY) * 0.1));
  }
</script>

<mesh scale={[size, size, size]} onwheel={resize} ondblclick={() => size = 1}>
  <boxGeometry />
  <standardMaterial color={[0.3, 0.8, 0.6, 1]} />
</mesh>
```

Canceling a cancelable wheel input also prevents orbit-camera zoom for that input.
The scene handles it before camera controls, even if its subscription was added
later. `stopPropagation()` only stops scene propagation; it does not cancel zoom.
Wheel input over empty space or geometry without eligible handlers still reaches
camera controls. With no camera controls, unhandled wheel input retains normal
browser behavior. Non-cancelable native wheel inputs cannot be canceled.

Native `deltaX`, `deltaY`, `deltaZ`, `deltaMode`, and modifier keys are available
on `originalEvent`. The example uses only direction for fixed size steps; code
using the delta magnitude must account for its native units. See
[WheelEvent behavior](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event).

The runtime installs one non-passive canvas wheel listener only while eligible
registered scene handlers exist. It reconciles that subscription when interaction
membership changes, not on every bounds or material update. The pinned Svelte
compiler retains a literal `onwheel={callback}` wrapper when `callback` becomes
null. Use `<group {...{ onwheel: enabled ? resize : null }}>` to actually remove
the registration without unmounting the group. Hiding all eligible geometry or
disposing the root removes the scene's canvas wheel listener too.

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
The same clocks exercise double-click/context-menu/wheel/over/out/cancel-driven state changes in
demand and manual modes. A retained wheel subscription adds no per-frame scan or
listener churn. Event dispatch without reactive changes does not request a frame.
