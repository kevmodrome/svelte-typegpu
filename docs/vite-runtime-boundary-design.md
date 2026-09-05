# Vite runtime boundary

## Scope and risk

Restore the supported Vite development path. Live verification of the existing
textured example fails at startup with a host node passed to DOM removal. High
risk because compiler renderer selection and development output define ownership.
No dependency upgrade, renderer shim or HMR implementation is included.

## Current program model

`compiler/vite.ts` configures the custom renderer for `.typegpu.svelte` files and
DOM mode for ordinary components. `Canvas.svelte` mounts `SceneHost.svelte` into
a GPU root, but Vite explicitly compiles that file with `push_renderer(null)`.
The docs precompiler and unit compiler do not exercise this exact configuration.
The Vite adapter sets obsolete `hot: false`, while vite-plugin-svelte 6 reads
`compilerOptions.hmr`; actual served scenes still contain `$.hmr` wrappers.

## Proposed program shape

```text
~ compiler/vite.ts: force compilerOptions.hmr false, including dynamic overrides
> src/SceneHost.svelte -> SceneHost.typegpu.svelte: declare GPU ownership in name
~ Canvas.svelte, scene-host.test.ts, gpu-lifecycle.test.ts: follow renamed host
+ src/vite-integration.test.ts: transform real app/host/viewport using Vite
~ package.json, pnpm-lock.yaml: declare the existing Vite version for these tests
~ type-tests/tsconfig*.json: follow renamed host

Vite client transform -> dedicated GPU filename -> custom renderer scope
Canvas async startup -> mount GPU SceneHost -> reactive child component
ordinary DOM components -> DOM renderer; viewport adapter -> DOM outer canvas
```

## Contracts and invariants

The shared adapter owns renderer selection and disables HMR; dynamic compiler
options cannot re-enable it. The internal scene host has no DOM markup and must
always mount its anchors in the GPU tree. Preserve public Canvas props, SSR shell,
scene replacement and disposal. The fix adds no frame-loop work.
Serialize the SSR pre-transform's MagicString source map, matching the client
post-transform, so the adapter satisfies Vite's plugin source-map contract.

## Vertical slices and verification

1. Reproduce HMR output and DOM scene-host scope using real Vite transforms in
   middleware mode. Use an unlistened HTTP server for HMR transport, so test setup
   requires no listening ports and does not mask the plugin's HMR setting.
2. Rename the internal host, force the compiler setting, and verify ordinary DOM,
   scene-only, dedicated viewport, client/server and dynamic-option output.
   Run full compiled lifecycle/motion tests, builds and Svelte checks. Verify the
   textured Vite example and docs previews in the browser. Commit separately.

## Risks and decisions

Special-casing an internal filename in the plugin would hide GPU ownership and
couple consumers to package paths. Naming the internal scene host consistently
with consumer scenes uses the established boundary instead. Enabling HMR needs
separate lifecycle work and is not a substitute for honoring the current contract.
The internal filename is not a public export; no consumer migration is needed.
Tests must use Vite transforms, not just direct Svelte compilation, to catch
configuration defaults and overrides. Rollback restores the old internal filename
and settings without data migration, but restores the observed dev-mode failure.

## Verification results

- Four real Vite transform cases pass: client-first/server-first compilation,
  with and without attempts to re-enable HMR through both compiler options hooks.
  GPU scenes and the internal host retain GPU scope, the canvas retains DOM scope,
  and the dedicated viewport keeps its GPU snippet out of server-rendered HTML.
- The workspace passes 991 tests: 5 workspace, 905 renderer, 47 docs and 34 example
  tests. Renderer TypeScript and Svelte checks pass with zero diagnostics. The
  production build passes; Vite reports its 500 kB chunk-size warning
  for the example's 500.07 kB main chunk.
- Live Vite startup changed from `node.remove is not a function` to a rendered
  checker-textured scene. Count and scale controls update it without console
  errors. The preview reported 120 FPS with 10,000 cubes; this is not an independent
  measurement of browser callback rate, GPU throughput or physical refresh rate.
  The docs Svelte Motion preview also renders and returns to Idle in demand mode.
