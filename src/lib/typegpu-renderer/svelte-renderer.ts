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
import { Dirty } from './dirty';
import { createSceneState, createTypeGpuSceneCache } from './scene-state';
import { createModelCache, type TypeGpuModelCacheOptions } from './model-cache';

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

interface RuntimeOptions {
  windowTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  loadUrl?: TypeGpuModelCacheOptions['loadUrl'];
  loadData?: TypeGpuModelCacheOptions['loadData'];
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
  gpu: TypeGpuRenderer,
  options: RuntimeOptions = {}
): RuntimeState {
  let queued = false;
  let dirty = Dirty.All;
  const onModelSettled = () => scheduleSync(root);
  const hasInjectedModelLoader = Boolean(options.loadUrl || options.loadData);
  const sceneCache = createTypeGpuSceneCache({
    onModelSettled,
    modelCache: hasInjectedModelLoader
      ? createModelCache({
          loadUrl: options.loadUrl,
          loadData: options.loadData,
          onSettled: onModelSettled
        })
      : undefined
  });
  const cameraInteraction = createCameraInteractionController({
    canvas,
    renderer: gpu,
    windowTarget: options.windowTarget
  });

  function scheduleSync(
    nextRoot: TypeGpuNode,
    _dirtyNode?: TypeGpuNode,
    dirtyMask: Dirty = Dirty.All
  ) {
    root = nextRoot;
    dirty = (dirty | dirtyMask) as Dirty;

    if (queued) return;

    queued = true;
    queueMicrotask(() => {
      queued = false;
      const sceneDirty = dirty;
      dirty = Dirty.None;
      const scene = createSceneState(root, sceneCache, {
        dirty: sceneDirty
      });
      gpu.setScene(scene);
      cameraInteraction.reconcile(scene);
    });
  }

  function dispatchCanvasClick(event: MouseEvent) {
    if (cameraInteraction.consumeSuppressedClick()) return;

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

export function createTypeGpuRuntimeForTest(
  root: TypeGpuNode,
  canvas: HTMLCanvasElement,
  gpu: TypeGpuRenderer,
  options: RuntimeOptions | Pick<Window, 'addEventListener' | 'removeEventListener'> = {}
): RuntimeState {
  if ('addEventListener' in options && 'removeEventListener' in options) {
    return createRuntime(root, canvas, gpu, { windowTarget: options });
  }

  return createRuntime(root, canvas, gpu, options);
}
