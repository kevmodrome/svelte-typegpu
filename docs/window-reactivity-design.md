# Reactive window values

## 1. Scope and risk

Make the real `svelte/reactivity/window` exports a verified scene-authoring option.
Standard risk: compiled consumer, lifecycle and cadence coverage; no new renderer
API or dependency patch. This is not an implementation of `<svelte:window>` and
does not change the decision to keep actions and scene CSS out of the API.

## 2. Current program model

Svelte's window module owns its signals and native subscriptions. Event-driven
values use `ReactiveValue`/`createSubscriber` and `svelte/events.on`. Our renderer's
native EventTarget routing already forwards those listeners with their original
receiver, handler and options. `compileTypeGpu` adapts small scene value props;
the runtime then uses targeted scene updates and the existing frame scheduler.

```text
window event -> Svelte signal -> compiled attribute or motion target effect
  -> existing attribute snapshot -> targeted scene update -> demand/manual render
```

## 3. Proposed program shape

```text
+ src/window-reactivity.test.ts       real exports, shared ownership, SSR and polling
+ src/window-motion.test.ts           real Tween/Spring, native resize and GPU clocks
~ vitest.config.ts                   resolve the real window module in client tests
~ docs/svelte-compatibility.md         supported values and upstream lifetime costs
+ docs/window-reactivity-design.md    contract and verification evidence
```

Keep the renderer unchanged unless a failing test identifies a renderer defect.
Import the real Svelte values in consumer source; do not introduce renderer-owned
window signals, mirror stores or a second animation scheduler.

## 4. Contracts and invariants

Resize, scroll and online/offline values share one native subscription per export
across active consumers; their last consumer releases it. Untracked reads do not
subscribe. Same-value events do not dirty scene buffers. Keyed replacement and
conditional removal preserve unrelated nodes and stop obsolete work. Server reads
are `undefined`, so consumer source supplies explicit fallbacks when needed.

The pinned Svelte implementation has separate lifetimes for two other paths:
`screenLeft`/`screenTop` poll once per observed export and stop after the last read
effect disappears; `devicePixelRatio` starts one resolution-query listener at
module initialization and rearms it on changes. Removing a scene does not destroy
that module subscription. Do not hide these costs behind a demand-idle claim.

Motion still belongs to the consumer component and is stopped on destruction.
The renderer must draw once per active callback tick, idle after settling, never
schedule renderer RAF in manual mode, and cancel queued work on disposal. Dirty
ranges, CPU instance storage and GPU resource identity remain bounded and local.

## 5. Vertical slices and verification

1. Complete: verify every window export against the pinned client implementation: event
   delivery/no-ops, snippets and keyed consumers, shared listener cleanup, lazy
   polling, resolution-listener rearming, and a real server-import check.
2. Complete: drive real compiled Tween/Spring targets from native resize at 60/120/144 Hz,
   with both explicit target effects and the native `Tween.of`/`Spring.of` factories,
   both producer/renderer orders and demand/manual modes. Check frame delivery,
   exact uploads, static-instance preservation, resource reuse and teardown.
   Document the consumer syntax and distinguish window size from canvas size.

## 6. Risks and unresolved decisions

Window dimensions describe the browser viewport, not a nested canvas. Continue
to use native canvas size bindings for container-dependent layouts. These imports
are not a substitute for native global event attributes or DOM delegation.
Upstream polling and DPR lifetimes are observed compatibility behavior, not new
renderer policy. No public migration, feature flag or rollback state is required.
Physical high-refresh verification remains separate from controlled clocks and
software-WebGPU rendering.

The `.of` factories establish their target effect immediately. A constant-duration
Tween can therefore start a full-duration no-op at construction. Use a duration
function that returns zero for equal scalar endpoints, and a primitive `$derived`
target to filter same-value window notifications. Both factories still need the
consumer's motion cancellation on destruction; removing their target effect alone
does not cancel an already-running producer.

## Verification results

The 20 window-value tests and 36 motion cases cover the contract. Test setup
resolves Svelte's actual `esm-env` dependency before selecting `BROWSER: true` for
happy-dom, leaving its real DEV/production flag intact. A separate Node process verifies the actual
server module without that override. No Svelte export is replaced with a fake
signal. The motion tests verify bounded factory startup (one producer callback),
natural settling, same-value notifications, exact final-instance uploads, 300
untouched static instances and unchanged buffers, bind groups and pipelines.

Actual SSR compilation also exposed a pinned Svelte limitation outside the
renderer: reading `innerWidth.current` directly inside `Tween.of`/`Spring.of`
attempts a native subscription from the factory's client render effect and throws
without `window`. Separate-process tests preserve that failing canary and verify
the documented `$derived` target with an explicit fallback renders on the server.
Do not present untracked server reads alone as proof of arbitrary SSR composition.

A real Vite-served dedicated viewport was checked in Chromium headless shell 1228
with SwiftShader, without a test-only browser flag or native-value mocks. At desktop
(1440 resized to 1200) and mobile (390 resized to 320), native width attributes
updated, `Tween.of` moved the mesh, offline/online events changed and restored its
material, same-value resize caused no submissions, and unmount removed the canvas
and stopped subsequent work. Changed pixels were 5,379/1,255 for motion and
2,573/1,842 for offline state. Resource counts stayed at 8 buffers, 5 bind groups
and 1 pipeline; both pages had no errors. Screenshots were inspected at both sizes.
The temporary probe server closed afterward; this is software-WebGPU evidence,
not physical display cadence or hardware GPU throughput.

The workspace passes 1,284 tests; the renderer passes 1,188 in both development
and production. The isolated async-candidate regression passes 1,334 development
and 1,314 production tests. Renderer TypeScript and Svelte checks pass with zero
diagnostics. No renderer implementation, installed dependency or app async flag
changed for this contract.
