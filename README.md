# Svelte TypeGPU Renderer

`svelte-typegpu` is an experimental custom renderer for Svelte that lets you
write TypeGPU scenes declaratively.

Instead of imperatively wiring WebGPU resources, render passes, cameras, and
scene state, you author `.typegpu.svelte` components with scene nodes such as
`<scene>`, `<mesh>`, `<boxGeometry>`, `<standardMaterial>`, and
`<perspectiveCamera>`. The renderer turns that Svelte component tree into
TypeGPU-managed resources, draw batches, lighting, camera state, and
interaction data.

The goal is to make TypeGPU feel native inside Svelte:

- Svelte components describe the scene graph.
- Svelte state and props drive transforms, materials, cameras, and animation.
- TypeGPU owns the WebGPU pipeline, buffers, bind groups, textures, and draws.
- The renderer package owns the bridge between Svelte's custom renderer API and
  TypeGPU.

This is not a Three.js wrapper and it is not a DOM component library. It is a
custom Svelte renderer for TypeGPU/WebGPU scenes.

This project currently targets the open Svelte custom renderer PR:
https://github.com/sveltejs/svelte/pull/18042

## Example

A TypeGPU scene is written as Svelte markup:

```svelte
<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  let position: Vector3Tuple = [0, 1, 0];
  let color: RgbaTuple = [0.94, 0.9, 0.82, 1];
</script>

<scene clearColor={[0.067, 0.078, 0.102, 1]}>
  <perspectiveCamera
    id="main"
    active={true}
    position={[4, 3, 6]}
    target={[0, 0, 0]}
    fov={45}
    near={0.1}
    far={100}
  ></perspectiveCamera>

  <ambientLight color={[1, 1, 1]} intensity={0.25}></ambientLight>
  <directionalLight rotation={[-0.8, 0.4, 0]} intensity={1.4}></directionalLight>

  <mesh {position}>
    <boxGeometry width={1} height={1} depth={1}></boxGeometry>
    <standardMaterial {color} roughness={0.3} metalness={0.1}></standardMaterial>
  </mesh>
</scene>
```

Mount it into a WebGPU canvas root from ordinary Svelte code:

```svelte
<script lang="ts">
  import { mount, onMount, unmount } from 'svelte';
  import renderer, { createTypeGpuRoot } from 'svelte-typegpu';
  import Scene from './Scene.typegpu.svelte';

  let host: HTMLDivElement;

  onMount(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    createTypeGpuRoot({ target: host, frameloop: 'always' }).then((root) => {
      if (disposed) {
        root.dispose();
        return;
      }

      const instance = mount(Scene, { renderer, target: root });
      cleanup = () => {
        void unmount(instance);
        root.dispose();
      };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  });
</script>

<div bind:this={host}></div>
```

Until Svelte's custom renderer API lands upstream, `.typegpu.svelte` files also
need to be compiled with the Svelte PR preview build described below.

## Setup

```bash
pnpm install
pnpm test
pnpm dev
```

The reusable renderer package lives in `packages/svelte-typegpu`. The current demo
application lives in `apps/example` and can be started directly with:

```bash
pnpm --filter example --fail-if-no-match dev
```

## Using the Svelte PR Preview

Until Svelte PR 18042 lands, apps using this package need the same Svelte
preview build and must configure `.typegpu.svelte` files to use the
`svelte-typegpu/svelte-renderer` custom renderer:

```bash
pnpm add svelte@https://pkg.svelte.dev/svelte/c/17e37a51bc539cdb6a923b424e5746fc6505ba89 svelte-typegpu
```

This repository pins the official preview for PR commit
`17e37a51bc539cdb6a923b424e5746fc6505ba89` (Svelte 5.57.0) in development and CI.
The published Svelte peer range alone does not provide the experimental API;
applications must install this preview until the PR lands.

The example app shows the current Vite setup in `apps/example/vite.config.ts`.
