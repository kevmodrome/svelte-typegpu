# svelte-typegpu Docs Site Design

## Goal

Build a new `apps/docs` documentation website for `svelte-typegpu` using Mochi. The site should explain the renderer, provide a quickstart path, and showcase a curated set of official TypeGPU examples rewritten as Svelte custom-renderer scenes with live previews and visible source code.

## Current Context

The repository is a pnpm workspace with the reusable renderer package in `packages/svelte-typegpu` and the current development sandbox in `apps/example`. The example app is useful for renderer work and should remain separate from the public documentation site.

The renderer currently supports a practical 3D scene surface: scenes, groups, meshes, instanced meshes, models, box/plane/sphere/buffer geometries, basic/Phong/standard materials, textures, samplers, ambient/hemisphere/directional/point/spot lights, perspective/orthographic cameras, pointer events, and camera controls. That makes a small curated gallery feasible now, while more advanced TypeGPU examples can wait until the renderer exposes lower-level shader, compute, post-processing, or shadow-map features.

Mochi should be used as the docs application framework. Based on the official Mochi documentation, the app should use server-rendered routes for static documentation content and hydrate only the browser-interactive islands with `mochi:hydrate`. This matches a documentation site where most content is static but live WebGPU previews need client execution.

References:

- Mochi docs: <https://mochi.fast/docs/docs-for-llms>
- Mochi selective hydration: <https://mochi.fast/docs/selective-hydration/>
- TypeGPU examples source: <https://github.com/software-mansion/TypeGPU/tree/main/apps/typegpu-docs/src/examples>

## Architecture

Create a new workspace app at `apps/docs`. It should not replace or absorb `apps/example`.

Proposed structure:

```text
apps/docs/
  package.json
  tsconfig.json
  src/
    index.ts
    style.css
    routes/
      Overview.svelte
      Quickstart.svelte
      Examples.svelte
    components/
      SiteShell.svelte
      SiteNav.svelte
      ExampleWorkbench.svelte
      ExamplePreview.svelte
      CodePanel.svelte
    examples/
      registry.ts
      two-boxes/
        TwoBoxes.typegpu.svelte
      phong-reflection/
        PhongReflection.typegpu.svelte
      simple-shadow/
        SimpleShadow.typegpu.svelte
    lib/
      create-preview-root.ts
      code-samples.ts
```

`apps/docs/src/index.ts` defines Mochi routes for `Overview`, `Quickstart`, and `Examples`. If Mochi's route API makes single-file route declarations more idiomatic, the implementation can adjust file names while preserving these route boundaries.

`SiteShell` and `SiteNav` provide the common document frame. `ExampleWorkbench` lays out the selected example with metadata, live preview, and code panel. `ExamplePreview` is the hydrated island that creates a TypeGPU root and mounts the selected `.typegpu.svelte` scene. `CodePanel` renders the source code string for the same example.

The examples registry is the source of truth for navigation and metadata:

- `slug`
- `title`
- `category`
- `tags`
- `description`
- `typeGpuSourceUrl`
- `scene`
- `code`
- `notes`

The code displayed on the page should be loaded from the actual example scene file at build time, using a raw import or a small generated registry. The preview and the visible source must not drift into separate hand-maintained examples.

## Initial Example Set

The first release should include three adapted examples:

1. `Two Boxes`
   - Source inspiration: official TypeGPU `rendering/two-boxes`.
   - Purpose: show the simplest useful scene graph translation from TypeGPU setup code into declarative `.typegpu.svelte` markup.
   - Renderer features: scene, camera, two box meshes, materials, directional/ambient light, animation.

2. `Phong Reflection Model`
   - Source inspiration: official TypeGPU `rendering/phong-reflection`.
   - Purpose: demonstrate material and lighting declarations in Svelte markup.
   - Renderer features: Phong/standard material, sphere or model-like primitive arrangement, multiple lights, camera framing.

3. `Simple shadow`
   - Source inspiration: official TypeGPU `rendering/simple-shadow`.
   - Purpose: show floor/subject composition, depth, lights, and material contrast in the renderer.
   - Renderer features: plane geometry, box or sphere subject, camera, lights, and material settings.
   - Scope note: if renderer-level shadow maps are not available during implementation, this example should be presented as a current-renderer adaptation rather than a claim of full shadow-map parity.

Each example should include a concise note that it is adapted from the TypeGPU example into the `svelte-typegpu` custom renderer.

## UI And UX

The site should feel like technical documentation with a live graphics workbench, not a marketing landing page. The first viewport should make the product identity clear with `svelte-typegpu`, a concise explanation of the renderer, and a visible preview/code split.

Navigation should be conventional:

- Brand/home at top-left.
- Primary links: `Overview`, `Quickstart`, `Examples`.
- Active state is visually clear.
- Mobile navigation stays compact and predictable.

The examples page should use a stable browsing model:

- Desktop: example list or rail on the left, workbench on the right.
- Mobile: compact example selector above the workbench.
- Preview and code are grouped as one workbench region.
- Preview area keeps stable dimensions before and after hydration to avoid layout shifts.
- WebGPU errors render inside the preview panel.

UX laws applied:

- Jakob's Law: use expected docs navigation and route behavior.
- Hick's Law: keep top-level choices limited to three primary destinations.
- Law of Proximity and Law of Common Region: group each example's metadata, preview, and code clearly without nesting cards inside cards.
- Chunking: split docs into Overview, Quickstart, and Examples instead of one long mixed page.
- Flow: keep preview loading and failure states local so users can continue reading code and docs.
- Aesthetic-Usability Effect: use deliberate typography, spacing, color, and animation polish, but not as a substitute for clear content and reliable states.

Visual direction: refined industrial/editorial documentation. Use a dark neutral canvas, restrained bright accents, dense but readable code surfaces, large live preview areas, and typography that feels intentional. Avoid generic purple-gradient demo styling and avoid over-decorated card-heavy layouts.

## Content

`Overview` should cover:

- What `svelte-typegpu` is.
- Why a Svelte custom renderer is different from a DOM component library or Three.js wrapper.
- The relationship between Svelte components and TypeGPU/WebGPU resources.
- A small example of declarative `.typegpu.svelte` scene markup.

`Quickstart` should cover:

- Installing the package and the temporary Svelte custom-renderer PR preview dependency.
- Configuring `.typegpu.svelte` files with the custom renderer.
- Mounting a TypeGPU root from a normal Svelte component.
- Current limitations while Svelte custom renderer support is still upstream PR based.

`Examples` should cover:

- Curated example selector.
- Live preview for the selected example.
- Source code for the selected `.typegpu.svelte` scene.
- Link back to the original TypeGPU example source where available.

## Error Handling

Preview errors should not break the docs shell. `ExamplePreview` should display a local status panel for:

- WebGPU not available.
- GPU device/root creation failure.
- Scene mount failure.

The fallback copy should be brief, specific, and useful. The code panel and surrounding docs must remain readable when preview initialization fails.

## Testing And Verification

Use test-driven implementation for behavior that can run without a GPU:

- Example registry contains the three required slugs and valid metadata.
- Each registry entry has a code sample and TypeGPU source URL.
- Route components include expected product name and navigation labels.
- Preview component includes a local fallback/error state.
- Code panel renders source text without treating it as HTML.

GPU behavior should be verified with local browser smoke testing because WebGPU availability in automated test environments is not guaranteed. The smoke check should confirm that the docs app starts, the Examples route loads, each example can be selected, the preview area remains stable, and WebGPU failures stay inside the preview panel.

Implementation verification should include:

```bash
pnpm --filter docs --fail-if-no-match test
pnpm --filter docs --fail-if-no-match build
pnpm test
pnpm build
```

If Bun is required by Mochi and is not available in the local environment, the implementation plan should include a preflight step to install or configure Bun before running Mochi commands.

## Open Scope

The first version intentionally excludes:

- Full TypeGPU gallery parity.
- Search across examples.
- Markdown/MDX content pipeline.
- Copy-code button.
- Live editable code.
- GPU shader, compute, post-processing, and full shadow-map example support beyond what the renderer already exposes.

The design should leave room for those features by keeping examples registry-driven and examples self-contained.
