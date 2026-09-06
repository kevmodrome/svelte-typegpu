# Asset world example

## 1. Scope and risk

Add a runnable lakeside campsite to the docs examples using locally bundled CC0
GLB assets, reusable scene components, native DOM controls and direct model events.
Standard risk: new multi-file example with async loading and motion; no renderer
API or scheduling changes. No physics, terrain engine or importer expansion.

## 2. Current program model

`example-definitions.ts` and `scripts/example-source-texts.ts` feed the docs
generator. `scene-components.ts` maps generated exports to `ExamplePreview`.
DOM-owned examples import a dedicated viewport and forward root/FPS callbacks.
`loadModel` loads immutable CPU assets; each GPU root owns resource caches.

```text
Examples route -> ExamplePreview -> DOM example -> dedicated viewport
  -> canvas root -> scene components -> model asset -> TypeGPU draws
```

## 3. Proposed program shape

```text
+ public/assets/asset-world/*.glb, License.txt, README.md
+ examples/asset-world/AssetWorld.svelte          controls/loading/error UI
+ examples/asset-world/WorldViewport.typegpu.svelte canvas/camera/lights/ground
+ examples/asset-world/Campsite.typegpu.svelte     shared models + keyed layout
+ examples/asset-world/Canoe.typegpu.svelte        one moving imported model
+ examples/asset-world/world.ts                  asset manifest/layout/loader
~ example registry, source imports, preview integration
+ renderer asset-world regression tests and browser probe
```

The DOM owner loads one asset set on mount with an AbortController, reports
progress/errors and exposes retry. Ready immutable assets pass through props.
Campsite reuses model assets across placements. One canoe uses a frameTask to bob;
selection uses direct model clicks, with equivalent native selection controls.
Day/night, pause, scenery visibility and camera reset are ordinary props/state.
No global asset cache, renderer IDs, extra RAF loop or manual GPU resource API.

## 4. Contracts and invariants

`loadWorldAssets(signal, onprogress): Promise<WorldAssets>` loads each manifest
entry once, rejects empty models, and never publishes obsolete results.
Retry aborts the old request; unmount aborts loading. Assets remain immutable.
The canvas/root survives control changes and asset retry. Only the moving canoe
changes transforms each simulation frame; static instance buffers remain stable.
Pause settles demand mode; manual draws only explicitly; disposal cancels work.
Reduced-motion preference pauses the continuous task. Data keys are Svelte keys.

## 5. Vertical slices and verification

1. Bundle a small licensed asset set and validate every GLB with the real importer.
   Inspect bounds/materials and assert all expected primitives load.
2. Integrate the complete campsite and controls. Test load success/failure/retry,
   selection, day/night, visibility and reset without canvas/resource remounts.
3. Verify compiled motion at 60/120/144 Hz, both callback orders with an external
   Svelte motion producer, manual mode, pause/disposal and targeted uploads.
   Live desktop/mobile WebGPU screenshots, canvas pixels, interactions, idle/frame
   submissions and errors. Live software GPU rate is not physical refresh proof.

## 6. Risks and decisions

Kenney Nature Kit is CC0; preserve its license and source URL. Real assets might
exercise unsupported importer features; validate first rather than adding broad
format support. GLB textures may resolve after CPU geometry; avoid declaring
texture completion from the loader. Bounding-box picking is approximate.
Existing uncommitted renderer optimization changes are outside this slice and
must not be accidentally committed. Generated outputs stay generator-owned.
