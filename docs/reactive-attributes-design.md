# Reactive structured attributes

## Scope and risk

Allow normal deep `$state` mutations in supported scene value props, including
vectors, colors, matrices, shader uniforms, bounds and material source/sampler
descriptors. Cover named/shorthand props, spreads, snippets and dynamic elements.
Risk: high; compiler lowering, reactive dependencies and renderer cache identity
meet here. No new scheduler, Svelte effects, actions, or host-binding translation.
Runtime-switchable canvas options are a separate investigation pending a live
scheduler baseline; they are not part of this change.

## Current program model

`compileTypeGpu`/the Vite preprocessor feed markup into the pinned Svelte compiler.
Its `set_attribute` caches values by identity before calling our renderer hook.
`core.ts:setAttribute` separately compares values before invalidating the scene.
Passing a `$state` array through `position={position}` reads no array entries
inside the Svelte effect. Changing `position[0]` therefore neither reruns that
effect nor invalidates the cached GPU instance. Compiled named/spread regressions
both reproduce zero scene updates after the mutation.

```text
position[0] mutation -> no tracked field read -> no host update -> stale GPU data
```

## Proposed program shape

Wrap supported structured value expressions before Svelte compilation. A small
runtime helper reads only the bounded fields consumed by renderer readers and
returns an immutable snapshot, reusing it when contents have not changed. These
reads belong to Svelte's existing attribute effect. Changed snapshots pass both
identity caches; ordinary invalidation handles targeted GPU writes.

```diff
+ src/attribute-values.ts: bounded value snapshots and spread adaptation
+ compiler/attributes.ts: AST-guided expression wrapping, excluding native canvas
~ compiler/index.ts: reuse parsed AST, source edits and hygienic imports
~ compiler/vite.ts: return prepared scene-only source as well as viewport source
~ package.json: private internal/attribute-values entry
~ src/viewport-test-utils.ts: resolve generated helper imports
+ src/reactive-attributes.test.ts: compiled mutation regressions
+ src/attribute-values.test.ts: reuse, bounds, identity and dependency tests
~ src/gpu-lifecycle.test.ts: deep-state motion/frame/resource checks
~ docs/svelte-compatibility.md and generated docs scene modules
```

```text
markup value -> snapshot helper inside existing template effect
  -> reads reactive scalar fields -> unchanged snapshot or changed immutable value
  -> Svelte set_attribute -> core.setAttribute -> existing targeted dirty path
```

## Contracts and invariants

- Snapshot only supported structured value names. Do not traverse model assets,
  vertex/index/texture byte arrays, shader functions, callbacks, attachments or
  arbitrary custom props. Shared immutable GPU inputs retain identity.
- Vector/color/quaternion/matrix array reads are bounded to 32 entries, matching
  the existing small-tuple comparison limit. Larger arrays remain reference-based;
  use correctly sized tuples or replace larger data explicitly.
- Vector objects copy x/y/z; bounds copy min/max; uniform records copy time,
  resolution and value0..value7; texture/sampler descriptors copy their existing
  reader fields. Nested uniform vectors are bounded tuples, not arbitrary graphs.
- Weak caches retain at most the latest small snapshot per input/schema.
  Unchanged small values allocate no new snapshot; changed values allocate only
  their changed records/tuples. Spread copies are owned by Svelte's attribute
  consumer, not cached. Texture snapshots use weak references: an unchanged map
  must not invalidate material resources during sibling spread updates, but the
  cache must not retain removed callbacks, model assets or large texture bytes
  through long-lived input objects. Snapshots are renderer-owned, not an
  imperative mutation API.
- Keep valid inline vector/color/matrix array expressions on their existing fast
  path: evaluating their entries already tracks primitive state. Snapshot uniform
  records even when inline because they may contain a stable nested state vector.
- Spreads preserve own enumerable string/symbol keys, event functions and
  attachments, including precedence and removals. Native canvas and component
  props are not rewritten; their receiving scene primitives own adaptation.
- No new frame loop, render effect, global node registry or source proxy mutation.
  SSR does not execute GPU snippets. Original-source maps/diagnostics stay intact.
  The shared compiler composes maps after Svelte compilation because the pinned
  compiler drops preprocessor sourcesContent while retaining transformed input.
  Caller preprocessing, value lowering and canvas/SSR lowering compose in order;
  source text and mapped script lines have regression coverage. Real Vite builds
  retain original source text through the plugin's existing map composition.

## Vertical slices and verification

1. Named/spread mutable vectors through the real compiler and scene cache, then
   structured schemas and mutation/replacement/deletion. Preserve callback,
   attachment, typed-array and model asset identities. Prove untouched scalar and
   inline tuple source paths, identifier hygiene, SSR and source maps.
2. Real Tween/Spring producers update state vector entries at 60/120/144 Hz, both
   callback orders and demand/manual modes. Verify same-frame values, single
   active frame, exact instance/upload ranges, resource reuse, bounded allocation,
   idle settling, unmount/disposal and removal of reactive dependencies.
3. Real Vite client/SSR builds, docs regeneration, full tests/builds/Svelte checks,
   and live verification when the Mac is available. Document reference-based
   bulk-data inputs and the need for the shared TypeGPU compiler integration.

## Alternatives and risks

Deep-reading inside core.setAttribute is insufficient: Svelte's identity cache
can skip the hook on subsequent calls. Per-attribute child effects would increase
the retained effect count and duplicate lifecycle ownership. Generic deep cloning
would traverse large assets and break resource identity. Requiring immutable
replacement everywhere contradicts normal `$state` authoring for small values.

The adapter is an intentional compiler feature; using the raw upstream compiler
does not gain it. Explicit resource keys still have their existing immutable
identity semantics, and typed arrays are not deep Svelte state. No language-tools
typing or physical-refresh-rate claims are implied. Rollback removes the wrappers
and private helper without changing scene/GPU formats.

## Verification

- `pnpm test`: 886 passing tests (5 workspace, 801 renderer, 46 docs, 34 example).
  This includes the 72-case compiled Canvas/viewport Tween/Spring matrix with
  deep tuple/object mutations, named/spread props, 60/120/144 Hz clocks and both
  callback orders in demand mode. Manual mode requests no renderer RAF.
- `pnpm build`: renderer typecheck, example production build and regenerated
  docs production build pass. `pnpm --filter svelte-typegpu check:svelte` reports
  zero errors and warnings. Vite client/SSR fixtures verify the private helper
  resolves and bundled source maps retain the authored component source.
- Live in-app browser: Svelte Motion rendered before and after regeneration;
  changing targets visibly moved the marker and settled to Idle. Native Events
  mesh clicks selected and rotated the middle cube through its state tuple, and
  native Escape reset its rotation. No browser errors or warnings were reported.
- Narrow viewport: all three cubes remained visible; canvas size bindings matched
  the actual 345x215 CSS size, and interaction still worked. The temporary viewport
  override was reset and the test tab closed. The preview remains on port 3334.

These live checks establish rendering, interaction and settled idle behavior, not
physical display refresh rate, CPU time or GPU throughput. Canvas-pixel extraction
is unavailable through the browser's read-only DOM interface; visual verification
used browser screenshots. High-refresh frame-delivery assertions use controlled
clocks and real compiled motion producers.
