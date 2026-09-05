# Keyed scene resets

## Scope and risk

Verify `{#key expression}` as a deliberate scene-subtree reset: change the key to
recreate child component state and attachments, while retaining the surrounding
scene and canvas. This differs from keyed `{#each}`, which preserves moved items.
Standard risk: compiler-owned lifecycle behavior needs renderer/resource evidence.
No new primitive, scheduler or compiler lowering is proposed.

## Current program model

`compileTypeGpu` delegates key blocks to the pinned Svelte compiler. The runtime's
`key` helper uses `BranchManager` to replace the block's effects and nodes. Renderer
insert/remove hooks then synchronize the scene and prune unreferenced resources.
Existing diagnostics traverse key blocks, but lifecycle and GPU tests have no
focused `{#key}` cases.

```text
key expression changes -> Svelte key/BranchManager -> effect teardown and mount
  -> renderer node removal/insertion -> scene synchronization -> GPU update
```

## Proposed program shape

```diff
+ src/key-blocks.test.ts        compiled state, snippet, attachment and await cases
~ src/gpu-lifecycle.test.ts     real motion across stable keys and explicit resets
~ src/viewport.test.ts          reset scenes without replacing native canvas/root
~ docs/svelte-compatibility.md  consumer contract and verified limits
```

Retain the existing compiler and renderer paths. Fix production code only if the
tests expose an actual ownership or rendering defect; revise this design first
if such a fix changes a shared contract.

## Contracts and invariants

- An unchanged key retains node identity, child state and attachments.
- A changed key recreates only its contents, runs cleanup once, and detaches the
  old subtree. Parent state, sibling nodes and the native canvas/root survive.
- Late promises in an obsolete keyed branch must not mount stale content.
- Stable keys during real Tween/Spring motion preserve targeted instance uploads
  and buffer/bind-group/pipeline reuse. Resetting a subtree is structural work,
  not a substitute for animating reactive props.
- Both RAF orders at 60/120/144 Hz deliver one frame per display callback; demand
  settles, manual never schedules renderer RAF, and disposal cancels pending work.

No public types or signatures change. Svelte owns branch effects; the existing GPU
root owns resource caches and disposal.

## Vertical slices and verification

1. Compile and mount keyed scene snippets/components; assert state reset, scoped
   cleanup, obsolete-promise suppression and dedicated canvas/root identity.
2. Run real motion before and after repeated resets through the mocked GPU backend;
   assert cadence, upload ranges, bounded resource allocation, idle/manual cleanup.
3. Document the proven consumer contract and run the full suite/typecheck. No live
   scheduling comparison is needed unless production scheduling changes.

## Risks and unresolved decisions

Do not claim zero allocations for changed keys: Svelte intentionally remounts the
subtree. GPU cache reuse depends on resource identity and references remaining
live. Host transitions are still upstream-gated; key blocks do not enable them.
No migration, fallback or new runtime feature flag is needed. Failures in upstream
branch management should be reproduced rather than patched by emulating DOM nodes.

## Results

The focused lifecycle cases pass without a production adapter: child state and
attachments reset through snippets, obsolete promise resolutions and rejections
do not remount, and a keyed scene retains its native canvas and GPU root.

All 18 real Tween/Spring cadence cases pass at 60/120/144 Hz in demand/manual mode,
with both callback orders in demand mode. Two resets during each animation retain
300 sibling identities and shared buffers, bind groups and pipelines. Stable
motion updates write only the moving instance's 96-byte range. Demand settles to
zero callbacks; manual schedules only the external motion producer; disposal
leaves no renderer callback or later submission.

No production compiler, renderer or scheduling change was necessary. These are
controlled-clock and mocked-GPU results, not a measurement of display refresh or
hardware GPU throughput.
