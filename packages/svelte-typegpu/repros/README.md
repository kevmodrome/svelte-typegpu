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
