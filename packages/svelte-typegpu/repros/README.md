# Async boundary teardown reproducer

Run from the workspace root:

```sh
pnpm --filter svelte-typegpu exec vitest run --config repros/vitest.config.ts
```

Against pinned Svelte PR 18042 commit `17e37a51bc539cdb6a923b424e5746fc6505ba89`,
the assertions pass but Vitest exits with status 1 and two unhandled rejections:
`TypeError: ref_node.before is not a function`. Both promise resolution and rejection
after unmounting a still-pending boundary trigger it. This is a failing reproducer,
not evidence that async expressions are ready to enable in the apps.

The default suite runs this reproducer in a child process and checks the precise
error via a structured reporter. A dependency change that fixes or alters it will
fail the compatibility canary, prompting re-evaluation. No unhandled errors are
suppressed in the application or renderer.

Trace: `destroy_effect` clears the boundary effect's renderer reference; the pending
count later reaches zero; `Boundary.#update_pending_count` tries to insert its
offscreen fragment with that cleared renderer. `insert_before` falls back to the
DOM's `before` method, which scene nodes intentionally do not implement.

Expected behavior: destroying a pending boundary prevents later offscreen content
insertion and releases pending state. No GPU or native DOM node emulation should
be needed. The reproducer uses the actual TypeGPU scene adapter and generated Svelte
output; WebGPU initialization is not required.

## Isolated candidate probe

These commands copy the installed Svelte package to a temporary directory, alias
all Svelte imports to that copy, and remove it after the test process finishes.
They never patch `node_modules`, change the lockfile, or enable async in the apps.
The candidate is a research artifact, not an active pnpm patch.

```sh
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs baseline
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs candidate
```

To compare only the original teardown bug:

```sh
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs baseline repros/async-boundary-unmount.test.ts
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs candidate repros/async-boundary-unmount.test.ts
```

The candidate guards offscreen insertion with the owning effect's `DESTROYED`
flag and releases the fragment reference either way. It does not return before
pending counters drain or change renderer scheduling. The original two teardown
tests pass with no unhandled errors in the candidate copy.

The broader probe also covers keyed replacement with a live sibling, partial
resolution followed by unmount, and removal of a nested boundary contributing to
its live parent's pending count. Every scenario runs with native DOM and scene
elements, for both late resolve and late reject.

The broader suite intentionally remains failing: attachments under a nested
boundary without its own pending snippet execute while the ancestor still shows
pending content. This happens in both hosts, with and without the candidate. Four
assertions preserve the desired lifecycle contract rather than accepting the
observed behavior. Pending counters drain and the parent appears, but early
attachment execution is a separate unresolved async-composition issue.

Verified on the pinned commit above:

| Probe | Passing / failing tests | Unhandled errors | Exit status |
| --- | --- | --- | --- |
| Full baseline | 12 / 4 | 6 teardown TypeErrors | 1 |
| Full candidate | 12 / 4 | 0 | 1 |
| Original teardown with candidate | 2 / 0 | 0 | 0 |

Type-check the opt-in probe code separately from the package's normal source:

```sh
rtk proxy pnpm --filter svelte-typegpu exec tsc -p repros/tsconfig.json
```

This opt-in suite is excluded from normal tests. The normal suite still checks
the precise original failure against the untouched installed dependency. Passing
the narrow teardown probe is not sufficient to enable experimental async scenes;
nested effects, GPU lifecycle, real motion cadence, and live rendering remain gates.
