# Hi-Z occlusion

Occlusion removes opaque color work hidden behind other opaque surfaces. It is
optional and composes with frustum culling and authored LOD:

```svelte
<!-- World.typegpu.svelte -->
<script>
  import Wall from './Wall.typegpu.svelte';
  import Tree from './Tree.typegpu.svelte';
  let { trees, assets, enabled = true } = $props();
</script>

<canvas frameloop="demand">
  <scene occlusion={enabled ? 'hi-z' : 'none'}>
    <perspectiveCamera active position={[0, 4, 24]} target={[0, 2, -12]} />
    <ambientLight intensity={0.7} />
    <Wall position={[-9, 5, 3]} size={[15, 12, 1]} />
    <Wall position={[9, 5, 3]} size={[15, 12, 1]} />
    {#each trees as tree (tree.id)}
      <Tree {assets} position={tree.position} />
    {/each}
  </scene>
</canvas>
```

Wall and Tree are ordinary custom-renderer Svelte components. There are no
occlusion IDs, hidden component mounts, special transforms, or another clock.
Hidden objects still update, remain pickable under the normal picking rules,
and cast shadows. Svelte motion updates the same canonical instance slots.

## How It Works

1. Keep the existing CPU frustum and LOD ranges.
2. Rank inexpensive, projected-large opaque occluders (at least 5% projected
   viewport area). Small batches can draw together; large shared batches use
   individual useful instances found through their existing bounds tree.
   Selection is cached and capped at 2,048 bounds tests, 32 depth draws, and
   32,768 total depth triangles; each selection uses at most 4,096 triangles.
3. Rasterize their actual geometry at the current camera and render resolution.
   Fully selected batches draw normally later and bypass self-culling. Partial
   batches still use Hi-Z, including the selected instances: their widened
   bounds cannot be hidden behind their own depth.
4. Build a max-depth pyramid. Uncovered pixels and power-of-two padding retain
   far depth; openings are never filled by enclosing bounding boxes.
5. Test expanded world AABBs on the GPU. Near-plane, unknown, and uncertain
   bounds remain visible. Stable compaction preserves canonical order within
   each selected range, then the GPU supplies indirect instance counts.

Current-frame depth avoids the disocclusion lag of naive previous-frame depth.
No GPU visibility result is read back to decide a render. Camera movement does
not upload canonical instances or bounds. Moving one instance adds one 32-byte
bound upload to its existing 96-byte instance upload.

## Limits and Measurement

Built-in opaque textured materials are supported. Their shader has no alpha
discard, so even sampled alpha does not change their opaque depth contract.
Transparent, vertex-alpha and custom materials remain excluded.
Scenes with shader passes, nonstandard depth writers, or disabled
depth use the normal path. `indirect-first-instance` is requested as an optional
device feature; missing features or exceeded buffer limits fall back to direct
draws. Disable the option to release its retained GPU resources.

`getRenderStats()` reports `occlusion` (`disabled`, `unsupported`,
`no-occluders`, `no-candidates`, or `active`), `occlusionCandidates`, `occlusionDepthTriangles`,
`occlusionDepthDraws`, `occlusionOccluderInstances`, `occlusionSelectionTests`,
and `occlusionCpuMs`. Selection tests are zero on a cached selection.
When `colorCountsExact === false`, `submittedInstances`
and `colorTriangles` are **pre-occlusion upper bounds**, not actual GPU counts.
`colorDraws` counts encoded commands, including zero-instance indirect commands.

Try `/examples/occlusion` for removable walls and a camera sweep, or enable
Hi-Z in `/examples/asset-world`. It is not necessarily faster in an open forest.
Measure total depth + compute + color cost, not just the final color pass.

### Declarative GPU Timing

```svelte
<canvas gpuTiming={profiling}>
  <scene occlusion={culling ? 'hi-z' : 'none'}>
    <Wall />
    {#each trees as tree (tree.id)}<Tree {...tree} />{/each}
  </scene>
</canvas>
```

`gpuTiming` is a live canvas option, off by default. No registration or frame
callback is needed. Both examples have a GPU timing checkbox. Renderer statistics
include `gpuTiming` (`disabled`, `unsupported`, `pending`, `ready`, `error`) and
an optional delayed `gpuTime` sample with frame, timestamp, occlusion state,
`totalMs`, `shadowMs`, `depthMs`, `pyramidMs`, `selectionMs`, and `colorMs`.

The total is a sum of pass durations, not end-to-end latency, queue wait, or
presentation time. Samples normally run at most every 250 ms during existing
frames; changing the occlusion option permits an immediate sample. A fixed
three-slot pool skips busy samples, never waits for readback, and never schedules
RAF. Disabling the option releases its resources. Missing optional timestamp
support is reported as unavailable, not zero milliseconds. Readback failure
stops sampling until the option is toggled off/on; rendering is unaffected.

Always associate a sample with its recorded configuration. The live examples
hide a previous configuration's timing while waiting for a matching sample.

From `packages/svelte-typegpu`, run `node repros/occlusion.mjs` with the same
`SVELTE_PROBE_BROWSER_DEPENDENCIES` and `SVELTE_PROBE_CHROMIUM` environment
variables used by the other browser probes. It requires a WebGPU adapter with
timestamp queries. It compares rendered pixels, reads actual indirect arguments
after rendering, validates stable full-record compaction, checks indexed LOD
ranges, and measures live frame delivery and resource reuse. Readback belongs
to the diagnostic only; it is never in the renderer's frame path. Add
`SVELTE_PROBE_SHARED_OCCLUDERS=1 SVELTE_PROBE_TEXTURES=1` to verify textured
occluders sharing a large batch, including zero sampled alpha with opaque blending.

On the local Apple Metal adapter, the 6,000-sphere wall/opening fixture retained
1,108 visible instances with identical images, including after camera changes.
An initial run reduced measured GPU pass time from 4.6 ms to 2.6 ms. Live LOD +
Hi-Z delivered 300 frames for 300 callbacks (about 120 FPS), without steady-state
resource creation. These are workload-specific observations, not guarantees or
proof of the physical display refresh rate. Manual GPU timings vary with load
and clock state; use sustained workload profiles for capacity planning.

## Cluster Experiment

Flat per-instance Hi-Z remains the default. An internal prototype tests a
conservative bound for each canonical 128-instance cluster before testing its
members. It reuses the existing bounds tree, preserves all component and slot
identities, and adds only a 32-byte cluster upload when one instance moves.
Camera movement uploads no clusters. Unknown, alpha, or near-plane clusters
fall through to individual tests. No consumer grouping or algorithm flag is
required, and the default path allocates no cluster buffers.

Run the browser probe with `SVELTE_PROBE_CLUSTER_BENCHMARK=1` and optionally
`SVELTE_PROBE_MODELS=50000` to compare disabled, flat, and clustered variants on
the same device, reversing their order and issuing four-frame GPU bursts.
The override exists only in the probe's Vite transform. It verifies image
equivalence, stable compaction, indexed LOD, near-plane motion, resize, timings,
resource reuse, and frame delivery. Compiled motion tests cover both algorithms.

One local Apple Metal 50,000-model run (means of forward/reverse measurements):

| View | No Hi-Z GPU ms | Flat GPU ms | Clustered GPU ms |
| --- | ---: | ---: | ---: |
| Wall opening, full detail | 27.59 | 7.39 | 6.87 |
| Angled, full detail | 23.27 | 18.83 | 18.80 |
| Wall opening, authored LOD | 9.09 | 4.26 | 4.38 |
| Angled, authored LOD | 8.09 | 6.83 | 7.46 |

Both algorithms retained the same 12,811 candidate instances in the blocked
view, with identical pixels. Selection itself took about 0.044 ms for both in
that view; the apparent total-time difference is not evidence of faster culling.
Clustering did not consistently earn its overhead, especially with LOD, so it
is not enabled for consumers. The live LOD+cluster test delivered 300 frames for
300 callbacks at approximately 120 Hz, but this is not a monitor refresh claim.

The next asset-world investigation is HLOD/impostors for *visible* distant
geometry, not another occlusion backend. Its consumer contract should be authored
representations on reusable asset components, selected by screen-space error,
without unmounting gameplay state or requiring manual per-frame switching.
