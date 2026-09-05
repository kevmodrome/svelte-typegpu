# Svelte attachment compatibility

## 1. Scope and risk

Make Svelte attachments usable for renderer-local behavior without IDs, DOM
shims, new clocks, or direct GPU mutation. Standard implementation scope with
public API and lifecycle risks: one event helper and attachment/node types.
Do not fork Svelte to enable unsupported host bindings or transitions.

## 2. Current program model

The pinned Svelte compiler emits `$.attach(hostNode, ...)` and `$.action(...)`.
Its attachment runtime owns reactive execution and cleanup. `core.ts` already
owns node event listeners and interaction invalidation; `svelte-renderer.ts`
dispatches picking events. The public renderer exposes low-level operations but
does not export attachment/node types or an unsubscribe-based event helper.

Compiler probes reject host `bind:this` and `transition:`. Component bindings
are a different path. Do not infer language compatibility from DOM Svelte docs.

```text
Svelte attachment effect -> host node -> listener registration
canvas picking -> node event -> Svelte state -> material/transform dirty path
Svelte cleanup -> listener removal -> interaction invalidation
```

## 3. Proposed program shape

```text
+ src/attachments.ts: TypeGpuAttachment and onNodeEvent(node, type, handler)
~ src/index.ts: export helper and existing node/event types
+ src/attachments.test.ts: compiled lifecycle/composition and compatibility tests
+ src/component-test-utils.ts: share existing compiler helper between test suites
~ src/component-renderer.test.ts: use shared helper
~ src/gpu-lifecycle.test.ts: actual Tween/Spring + compiled component cadence tests
~ docs motion example: stable hover attachment drives ordinary material props
+ docs/svelte-compatibility.md: verified support, boundaries, authoring guidance
```

No new runtime scheduler, host node wrapper, per-frame attachment reconciliation,
or competing state store. The compiler helper is test-only and excluded from the
published package. Authored example sources and generated counterparts stay paired.

## 4. Contracts and invariants

- `TypeGpuAttachment = (node: TypeGpuNode) => void | (() => void)` describes our
  non-DOM target. Built-in DOM attachments/actions are not automatically portable.
- `onNodeEvent(node, type, handler): () => void` delegates to existing listener
  operations, returns idempotent cleanup, and owns its own registration even if
  two attachments pass the same callback. No RAF or scene projection is added.
- Use Svelte state/props for animation; do not mutate node internals or derived
  GPU descriptors. Attachments own subscriptions; Svelte owns their lifetime.
- Keyed moves preserve attachment lifetime. Reactive replacement, conditional
  removal, and component unmount clean up exactly once. Visibility is not unmount.
- Root GPU disposal does not replace Svelte component unmount. Keep the established
  `unmount(component)` then `root.dispose()` ownership sequence.

## 5. Vertical slices and verification

1. Typed attachment authoring: compiled mount/reactive replacement/conditional
   cleanup, keyed moves, prop-spread forwarding, legacy action cleanup, component
   bindings, and explicit unsupported-host compiler tests. Independent listeners
   and no-op repeated cleanup are covered directly.
2. Performance: real Tween/Spring sources bind a compiled scene while the real
   GPU renderer uses mocked GPU resources and a shared controlled RAF queue.
   Test 60/120/144 Hz with both callback orders, one draw per steady-state frame,
   bounded idle settling, teardown cancellation, targeted uploads, stable buffers
   and pipeline/bind-group counts. Do not equate synthetic Hz with monitor output.
3. Example: pointer enter/leave updates marker appearance through Svelte material
   props. Check live FPS, nonblank desktop/mobile rendering, interaction, and logs.
   Run all tests/builds and regenerate examples only with the dev watcher stopped.

## 6. Risks and decisions

An alternative is a general imperative node wrapper with methods and frame
subscriptions. That adds identity, mutation ownership, and lifecycle rules before
they are needed. Exporting the existing target type and one listener helper keeps
attachments ordinary functions and introduces no cost for unattached scene nodes.

DOM-style host bindings/transitions require upstream compiler/runtime work; do not
claim support or silently translate them. Keep compiler rejection tests as an
upgrade signal. Existing markup and event props remain unchanged; new exports are
additive and the demo can be reverted independently. No persistent migration.

References: [Svelte attachments](https://svelte.dev/docs/svelte/@attach) and the
pinned `.svelte-pr/packages/svelte/src/compiler/phases/2-analyze/visitors/BindDirective.js`.

## Verification results

- `TMPDIR=/tmp pnpm test`: 501 tests pass (430 renderer, 42 docs, 24 example,
  5 workspace). `TMPDIR=/tmp pnpm build`: renderer type-check and both production
  builds pass. The package-contents test also excludes the shared test helper.
- The 12 real-motion cases cover Tween/Spring at 60/120/144 Hz in both observed
  callback orders. Each active tick submits one frame; all writes target the
  animated instance's 96-byte slot among 300 static peers. No buffers, bind
  groups, or mesh pipelines are created during motion, and the attachment setup
  runs once. Motion settles to an empty RAF queue; unmount cleans up once.
- The live 2,000-cube preview retains 60 FPS on the verification browser, matching
  its pre-attachment rate. Pointer entry changes the marker from red to white;
  pointer exit restores red. Screenshot pixel checks confirmed both changes.
- Desktop (1280x720) and mobile (390x844) previews render nonblank scenes with
  controls inside the page width and no browser warning/error logs. The mobile
  canvas check found more than 12,000 bright scene pixels. This is visual/scheduler
  verification, not a physical-monitor refresh-rate measurement.
- Host `bind:this`, transition/in/out, and animate directives remain explicit
  upstream rejections; component references/bindings are verified separately.
