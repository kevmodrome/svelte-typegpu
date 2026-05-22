import { createRenderer } from 'svelte/renderer';
import { findFirstInteractiveMesh } from './components/mesh';
import { createCameraInteractionController } from './camera-interaction';
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
import { invalidatesDrawBatches, invalidatesLights } from './scene-dirtiness';
import { createSceneState, createTypeGpuSceneCache } from './scene-state';

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
  canvas.className = 'renderer-root-canvas';
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
  let drawBatchesDirty = true;
  let lightsDirty = true;
  let syncedTreeRevision = -1;
  const sceneCache = createTypeGpuSceneCache();
  const cameraInteraction = createCameraInteractionController({ canvas, renderer: gpu });

  function scheduleSync(nextRoot: TypeGpuNode, dirtyNode?: TypeGpuNode) {
    root = nextRoot;
    drawBatchesDirty ||= invalidatesDrawBatches(root, dirtyNode, syncedTreeRevision);
    lightsDirty ||= invalidatesLights(root, dirtyNode, syncedTreeRevision);

    if (queued) return;

    queued = true;
    queueMicrotask(() => {
      queued = false;
      const scene = createSceneState(root, sceneCache, {
        reuseDrawBatches: !drawBatchesDirty,
        reuseLights: !lightsDirty
      });
      gpu.setScene(scene);
      cameraInteraction.reconcile(scene);
      syncedTreeRevision = root.treeRevision;
      drawBatchesDirty = false;
      lightsDirty = false;
    });
  }

  function dispatchCanvasClick(event: MouseEvent) {
    const mesh = findFirstInteractiveMesh(root, 'click');
    if (!mesh) return;

    dispatchNodeEvent(mesh, 'click', {
      originalEvent: event
    });
  }

  canvas.addEventListener('click', dispatchCanvasClick);

  return {
    scheduleSync,
    dispose() {
      cameraInteraction.dispose();
      canvas.removeEventListener('click', dispatchCanvasClick);
      gpu.dispose();
    }
  };
}
