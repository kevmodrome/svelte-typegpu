import { mount, unmount, type Component } from 'svelte';
import renderer, { createTypeGpuRoot, type TypeGpuRoot, type TypeGpuRootOptions } from './svelte-renderer';

export function startCanvasScene<Props extends Record<string, any>>(
  options: TypeGpuRootOptions,
  component: Component<Props>,
  props: Props,
  context: Map<any, any>,
  callbacks: {
    configure?(root: TypeGpuRoot): void;
    ready(root: TypeGpuRoot): void;
    error(error: unknown): void;
    cleared(root: TypeGpuRoot | null): void;
  }
): () => void {
  let disposed = false;
  let ownedRoot: TypeGpuRoot | null = null;
  let instance: ReturnType<typeof mount> | null = null;
  function cleanup() {
    const current = instance;
    instance = null;
    try { if (current) void unmount(current); }
    finally {
      const root = ownedRoot;
      ownedRoot = null;
      root?.dispose();
      callbacks.cleared(root);
    }
  }
  function fail(error: unknown) {
    cleanup();
    if (!disposed) callbacks.error(error);
  }
  void createTypeGpuRoot({ ...options, onSceneError: fail }).then((root) => {
    if (disposed) { root.dispose(); return; }
    ownedRoot = root;
    callbacks.configure?.(root);
    instance = mount(component, { renderer, target: root, context, props });
    callbacks.ready(root);
  }).catch(fail);
  return () => { disposed = true; cleanup(); };
}
