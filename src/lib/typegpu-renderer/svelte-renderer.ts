import { createRenderer } from 'svelte/renderer';
import { findFirstInteractiveBox } from './components/box';
import { createTypeGpuRenderer, type TypeGpuRenderer } from './gpu-renderer';
import {
  addEventListener,
  createComment,
  createElement,
  createFragment,
  createTextNode,
  dispatchNodeEvent,
  getAttribute,
  getFirstChild,
  getLastChild,
  getNextSibling,
  getParent,
  hasAttribute,
  insert,
  remove,
  removeAttribute,
  removeEventListener,
  setAttribute,
  setText,
  type TypeGpuNode,
  type TypeGpuRuntime
} from './core';
import { createSceneState } from './scene-state';

export interface TypeGpuRootOptions {
  target: HTMLElement;
  canvas?: HTMLCanvasElement;
  onFps?: (fps: number) => void;
}

export type TypeGpuRoot = TypeGpuNode & {
  canvas: HTMLCanvasElement;
  gpu: TypeGpuRenderer;
  dispose(): void;
};

interface RuntimeState extends TypeGpuRuntime {
  dispose(): void;
}

const renderer = createRenderer({
  createFragment,
  createElement,
  createTextNode,
  createComment,
  nodeType(node: TypeGpuNode) {
    return node.kind;
  },
  getNodeValue(node: TypeGpuNode) {
    return node.value ?? null;
  },
  getAttribute,
  setAttribute,
  removeAttribute,
  hasAttribute,
  setText,
  getFirstChild,
  getLastChild,
  getNextSibling,
  insert,
  remove,
  getParent,
  addEventListener,
  removeEventListener
});

export default renderer;

export async function createTypeGpuRoot({
  target,
  canvas = document.createElement('canvas'),
  onFps
}: TypeGpuRootOptions): Promise<TypeGpuRoot> {
  canvas.className = 'three-root-canvas';
  if (!canvas.parentNode) target.append(canvas);

  const gpu = await createTypeGpuRenderer({ canvas, onFps });
  const root = createFragment() as TypeGpuRoot;
  const runtime = createRuntime(root, canvas, gpu);

  root.runtime = runtime;
  root.canvas = canvas;
  root.gpu = gpu;
  root.dispose = runtime.dispose;
  runtime.scheduleSync(root);

  return root;
}

function createRuntime(
  root: TypeGpuNode,
  canvas: HTMLCanvasElement,
  gpu: TypeGpuRenderer
): RuntimeState {
  let queued = false;

  function scheduleSync(nextRoot: TypeGpuNode) {
    root = nextRoot;

    if (queued) return;

    queued = true;
    queueMicrotask(() => {
      queued = false;
      gpu.setScene(createSceneState(root));
    });
  }

  function dispatchCanvasClick(event: MouseEvent) {
    const box = findFirstInteractiveBox(root, 'click');
    if (!box) return;

    dispatchNodeEvent(box, 'click', {
      originalEvent: event
    });
  }

  canvas.addEventListener('click', dispatchCanvasClick);

  return {
    scheduleSync,
    dispose() {
      canvas.removeEventListener('click', dispatchCanvasClick);
      gpu.dispose();
    }
  };
}
