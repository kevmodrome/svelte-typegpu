# Lazy mesh noise resources

## 1. Scope and risk

Avoid allocating or computing Perlin data for meshes whose shaders do not use it,
without a consumer flag or shader-source inspection. Standard risk: resource
initialization moves from renderer construction to mesh pipeline preparation.
No scheduling, material API, shader-pass, or dependency-version changes.

## 2. Current program model

`gpu-renderer.ts` owns `PipelineResourceCache` and destroys it before its TypeGPU
root. `resource-caches.ts` eagerly calls `perlin3d.staticCache` in the constructor,
then injects its gradient function into every mesh pipeline. The built-in shader
does not use Perlin; `smoky-triangle-material.ts` does. Live browser measurements
show a 524,288-byte storage buffer, 12-byte guarded-compute uniform, and compute
submission even for a plain box scene.

```text
renderer construction -> pipeline cache -> noise allocation + dispatch
mesh preparation -> getOrCreate -> createMeshPipeline -> resolve on first use
```

## 3. Proposed program shape

Bind `perlin3d.getJunctionGradientSlot` to an unfilled, cache-local TypeGPU slot.
During pipeline preparation, call `root.unwrap` to resolve the shader. If TypeGPU
reports `MissingSlotValueError` for exactly our slot, create the existing static
cache outside resolution and retry with its injection. Unrelated errors propagate.
Later pipelines use the resolved binding; there is at most one dependency retry
per cache. Native shader/pipeline creation happens only after successful resolution.

The initial `tgpu.lazy(() => staticCache(...))` proposal was tested and rejected:
TypeGPU 0.11.6 forbids nested resolution contexts, so the compute dispatch inside
the lazy computation corrupts the outer resolution stack. The missing-slot path
uses exported APIs and never nests contexts or changes installed dependencies.

```text
~ packages/svelte-typegpu/src/resource-caches.ts
+ packages/svelte-typegpu/src/pipeline-resources.test.ts
~ packages/svelte-typegpu/src/gpu-renderer.test.ts
~ packages/svelte-typegpu/repros/boundary-snippets/browser.mjs
+ packages/svelte-typegpu/repros/noise-resources.mjs

renderer construction -> pipeline cache -> unfilled binding (no GPU work)
mesh pipeline preparation -> resolve -> only if our gradient slot is missing:
  unwind resolution -> staticCache once -> inject -> resolve -> cache pipeline
```

Retain the cache across pipeline pruning to avoid repeated compute on conditional
scene changes. Remove eager noise allocation and the source-string injection test.
Keep existing scene-time pipeline preparation; resolution now happens there rather
than inside the first draw. Cached frame paths remain a map lookup with no retry.

## 4. Contracts and invariants

`getOrCreate(batch, depth)` retains its signature and pipeline-key behavior.
The optional `#perlin3dCache` is owned by `PipelineResourceCache`; `dispose()` is
idempotent, destroys it if present, and rejects subsequent creation.
No-noise custom fragments also allocate nothing. All noise pipelines on a root
share one cache; different roots never share GPU resources. Shader compilation
errors propagate as before. Initialization is synchronous and introduces no RAF.

## 5. Vertical slices and verification

1. Real TypeGPU/noise with a recording GPUDevice: no unused allocation, first-use
   initialization, identical generated noise WGSL to eager injection, depth and
   fragment variants sharing resources, root isolation, prune/recreate, disposal.
2. Run compiled Tween/Spring cadence tests at 60/120/144 Hz in both callback orders
   and manual mode, retaining exact upload/resource reuse and idle assertions.
3. Real browser before/after at desktop/mobile: plain scene loses noise resources,
   identical pixels and motion, live smoky material still renders and animates.
   Update the isolated boundary browser probe's exact cleanup expectations.

## 6. Risks and unresolved decisions

The one dependency retry repeats partial TypeGPU resolution, not native pipeline
compilation, on the first Perlin shader only. Tests compare the generated compute
and render WGSL byte-for-byte with eager injection. An explicit material flag
would leak resource plumbing into the API; detecting all custom fragments would
still allocate for unrelated shaders. Static-cache construction failure retains the
upstream root/device cleanup contract. Physical display refresh remains a separate
gate from software-WebGPU pixels and synthetic cadence. Compiler patch approval
is independent and remains untouched.

Reference: https://docs.swmansion.com/TypeGPU/apis/slots/

## Verification results

- The recording-device tests use the real TypeGPU and noise implementations.
  They verify dependency-specific initialization, shader-local overrides, root
  isolation, bounded reuse, error propagation, disposal, and identical eager/lazy
  compute and render WGSL.
- All 1,308 development workspace tests and 427 focused production resource and
  cadence tests pass. Package TypeScript and Svelte checks pass with zero errors
  and warnings. The existing compiled lifecycle,
  Tween/Spring, reduced-motion, and window-motion matrices retain frame delivery,
  exact targeted uploads, no resource churn, manual behavior, idling, and disposal.
- Plain viewport browser allocation decreases from eight to six buffers and five
  to four bind groups, removing 524,300 bytes and the startup compute dispatch.
  One render pipeline remains. All six buffers are explicitly destroyed.
  Desktop/mobile ready/failed screenshots are pixel-identical before/after.
- At both 1440- and 390-pixel viewports the smoke probe changes 35,228 material
  pixels and 6,002 animation pixels. Sixty manual frames make sixty submissions
  without new buffers/pipelines. Material switches reuse one 512 KiB noise buffer
  and one initialization compute pipeline. There are zero RAF requests, no browser
  or GPU validation errors, and no work after unmount. The noise buffer is explicitly
  destroyed; TypeGPU's internal 12-byte uniform is released by the owned device.
- Browser runs use SwiftShader. They establish rendered output/resource behavior,
  not physical monitor refresh or hardware GPU throughput.
