# Texture load cancellation

## Scope and risk

Make conditional scene removal cancel root-owned texture requests and avoid
obsolete image decoding/rasterization. High risk: asynchronous completion,
resource sharing and disposal intersect. No new primitive, loader promise API,
global cache, frame loop or DOM action support. Hidden attached nodes retain
ownership; only loss of the last live resource key cancels work.

## Current program model

`TextureResourceCache` in `src/resource-caches.ts` starts URL/embedded image loads
and retains one resource per texture key. `prune` and `dispose` invalidate a
generation; a late result is closed before GPU upload. Fetch has no signal, and
HTML image decoding can still rasterize after the owning scene disappears.
`gpu-renderer.ts` prunes from the compiled scene's live texture keys and wakes a
demand frame on a live load's settlement. That ownership remains authoritative.

## Proposed program shape

```text
~ src/resource-caches.ts: pending controller map, signal-aware decode stages
~ src/gpu-renderer.test.ts: requests, races, decode cleanup and shared ownership
~ src/gpu-lifecycle.test.ts: compiled conditional scenes and controlled clocks
~ docs/svelte-compatibility.md: conditional texture ownership contract

Svelte {#if}/keyed removal -> existing scene sync -> prune last texture key
  -> invalidate generation -> abort pending controller -> remove cache entry
URL fetch -> blob -> bitmap / HTML decode -> live check -> TypeGPU upload
  -> release decoder and pending controller -> existing bounded invalidation
```

`loadMaterialTextureImageSource(source, signal?)` remains an internal helper.
Each pending URL/embedded load owns one AbortController; data textures need none.
Only pending loads occupy the controller map. Settlement removes its own entry
by identity so an old load cannot remove a newer same-key controller.

## Contracts and invariants

- Shared keys have one request. Removing one owner or hiding it does not abort.
- Last-owner removal and root disposal abort pending work immediately when scene
  synchronization prunes resources. Re-adding the same key starts a fresh request.
- Cancellation never publishes a failed resource or requests a late frame.
- Check cancellation before fetch/decode/rasterization and after async stages.
  `createImageBitmap` itself cannot be cancelled: close its eventual result and
  do not enter HTML fallback. No detached decoder starts a GPU upload.
- HTML fallback releases its object URL and image source on cancellation, success
  or failure, exactly once. A late decode cannot rasterize or resurrect resources.
- No per-frame allocation/lookup path changes. Successful textures retain GPU
  reuse and existing failure fallback behavior; manual mode never schedules RAF.

## Vertical slices and verification

1. Reproduce requests surviving prune/dispose; implement abort ownership and
   signal-aware decoding. Test same-key races, shared keys, failure and bitmap/HTML
   cleanup; commit the independently verified resource change.
2. Compile ordinary conditional textured scenes with the real runtime. At
   60/120/144 Hz, verify pending cancellation, bounded demand settlement, manual
   drawing, hidden/shared retention, resource reuse and disposal. Retain the real
   Tween/Spring cadence matrix. Run full tests/builds and live scene checks.

Integration evidence found an existing unnecessary uniform-buffer replacement
when a texture changes from loading to ready. Keep the material-owned uniform
buffer across binding refreshes; rewrite its contents only when the uniform key
changes. The texture requires a new bind group, not a new uniform buffer. Verify
shader values updated during loading survive settlement, and prune/dispose still
destroy each buffer once. Keep this optimization in a separate commit.

## Risks and decisions

Generation checks alone prevent stale GPU uploads but retain avoidable network
and CPU work, so they remain a final guard rather than the cancellation mechanism.
A global URL cache would complicate ownership across roots; use the existing
root-local resource key contract. Abort is advisory for bitmap decoding, and
synchronous rasterization cannot be interrupted once started. No public format or
data migration is needed; rollback removes cancellation while retaining the
existing generation guard. Live checks cannot prove physical refresh rate.

## Verification results

- `27b739d` adds cancellation ownership and 13 unit cases covering fetch/decode
  cancellation, same-key races, successful controller release and decoder cleanup.
- `a67616f` preserves material uniform buffers across texture settlement. Twelve
  compiled conditional-scene cases cover 60/120/144 Hz, demand/manual modes and
  both settlement orders. Four material cases cover standard/shader uniforms and
  successful/failed loads, including updates made while loading.
- Hidden and shared owners retain one request. Last-owner removal and disposal
  abort it, and obsolete completion produces no upload or frame. Live settlement
  performs no instance writes or buffer/pipeline creation; only the texture and
  required bind group change. Manual mode schedules no RAF; demand work settles.
- Full workspace verification passes 991 tests, including the existing compiled
  real Tween/Spring cadence matrix, plus production builds and Svelte checks.
  Live checker-texture rendering exposed a separate Vite compiler-boundary bug;
  its fix and browser evidence are recorded in
  [Vite runtime boundary](vite-runtime-boundary-design.md).
