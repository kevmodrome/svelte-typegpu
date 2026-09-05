# Svelte language compatibility

This contract applies to the pinned custom-renderer preview, not to arbitrary
Svelte releases. We test compiled components against the actual host renderer.

| Feature | Current status |
| --- | --- |
| Reactive state, component props, `{#if}`, keyed `{#each}` | Supported and tested |
| `{#snippet}` and `{@render}` | Supported, including attachment forwarding |
| Component `$bindable` props and component `bind:this` | Supported and tested |
| `Tween` / `Spring` bound to transforms and material values | Supported; frame delivery tested at 60/120/144 Hz in both RAF callback orders |
| `{@attach}` | Supported on scene nodes, including reactive replacement and component prop spreads |
| `use:` | Supported for renderer-safe actions with update/destroy cleanup |
| Host-element bindings, including `<mesh bind:this>` | Rejected by the pinned upstream compiler |
| `transition:`, `in:`, `out:`, `animate:` on host nodes | Rejected by the pinned upstream compiler |
| `{#await}`, boundaries, and cross-component context | Not yet part of our explicit compatibility test matrix |

DOM-oriented libraries are not automatically compatible. Scene nodes are not
HTMLElements and do not implement layout, CSS, Web Animations, or DOM event APIs.
Keep DOM controls in an ordinary Svelte component outside the scene.

## Attach reusable behavior

An attachment receives the actual scene node. Use `TypeGpuAttachment` and
`onNodeEvent` from `svelte-typegpu` for renderer-local event behavior:

```ts
import { onNodeEvent, type TypeGpuAttachment } from 'svelte-typegpu';

export function trackHover(onChange: (hovered: boolean) => void): TypeGpuAttachment {
  return (node) => {
    const enter = onNodeEvent(node, 'pointerenter', () => onChange(true));
    const leave = onNodeEvent(node, 'pointerleave', () => onChange(false));
    return () => {
      enter();
      leave();
      onChange(false);
    };
  };
}
```

```svelte
<script lang="ts">
  import { trackHover } from './hover';
  let hovered = $state(false);
  const hover = trackHover((value) => hovered = value);
</script>

<mesh {@attach hover}>
  <boxGeometry />
  <standardMaterial color={hovered ? [1, 1, 1, 1] : [1, 0.2, 0.3, 1]} />
</mesh>
```

There is no target ID or additional animation loop. The event changes Svelte
state, and the material binding uses the normal targeted upload path. Keep the
attachment function stable when its setup need not change on every motion tick.

`onNodeEvent` returns an idempotent unsubscribe function. Each subscription owns
its listener, even when another attachment uses the same callback. The runtime
routes click, pointer down/up/move/enter/leave, and drag start/move/end events from
canvas picking. These are `TypeGpuNodeEvent` values, not DOM events; the original
browser event is available as `originalEvent`. No new bubbling/capture semantics
are added by this helper.

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
