# Three Custom Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a minimal Svelte custom renderer that maps `.three.svelte` components to a Three.js scene graph.

**Architecture:** The renderer has a framework-independent core that creates wrapper nodes, maps node names to Three objects/resources, applies Svelte attributes to Three properties, and manages insertion/removal. A Svelte-facing adapter imports `createRenderer` from the Svelte PR branch and exposes `render` plus `createThreeRoot` for DOM canvas mounting.

**Tech Stack:** Svelte PR #18042, Vite, TypeScript, Three.js, Vitest.

---

### Task 1: Core Tree Operations

**Files:**
- Create: `src/lib/three-renderer/core.ts`
- Test: `src/lib/three-renderer/three-renderer.test.ts`

- [ ] Write tests for creating elements, inserting children, preserving sibling order, moving nodes between parents, and removing nodes.
- [ ] Run `npm run test -- src/lib/three-renderer/three-renderer.test.ts` and confirm the tests fail before implementation.
- [ ] Implement wrapper node creation and DOM-like tree operations.
- [ ] Run the focused test command and confirm it passes.

### Task 2: Attribute and Resource Mapping

**Files:**
- Modify: `src/lib/three-renderer/core.ts`
- Test: `src/lib/three-renderer/three-renderer.test.ts`

- [ ] Write tests for geometry/material assignment and common attributes such as `position`, `rotation`, `scale`, `visible`, `fov`, and `color`.
- [ ] Run the focused tests and confirm failures.
- [ ] Implement Three factory creation, resource slot assignment, and attribute application.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Svelte Adapter and Demo

**Files:**
- Create: `src/lib/three-renderer/svelte-renderer.ts`
- Create: `src/App.three.svelte`
- Create: `src/main.ts`

- [ ] Wire `createRenderer` from `svelte/renderer` to the core operations.
- [ ] Add `createThreeRoot` to own the canvas, Three renderer, resize handling, invalidation, and pointer event dispatch.
- [ ] Add a demo `.three.svelte` component with a camera, lights, mesh, geometry, material, and reactive click behavior.
- [ ] Run `npm run build` and fix integration issues.

### Task 4: Final Verification

**Files:**
- Modify as needed based on verification.

- [ ] Run `npm run test`.
- [ ] Run `npm run build`.
- [ ] Start `npm run dev -- --port 5173`, verify the local URL opens, and leave the server running for the user.
