import { createRenderer } from 'svelte/renderer';
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
import type { TypeGpuInteractionHit, TypeGpuInteractionTarget, TypeGpuSceneState } from './types';

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
  let currentScene: TypeGpuSceneState | null = null;
  let hoveredTarget: TypeGpuInteractionTarget | null = null;

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
      currentScene = scene;
    });
  }

  function dispatchCanvasClick(event: MouseEvent) {
    if (cameraInteraction.consumeSuppressedClick()) return;

    const hit = pickCanvasTarget(event, 'click');
    if (!hit) return;

    dispatchNodeEvent(hit.node, 'click', {
      originalEvent: event,
      detail: {
        instanceId: hit.instanceId,
        point: hit.point
      }
    });
  }

  function dispatchCanvasPointerMove(event: PointerEvent) {
    const moveHit = pickCanvasTarget(event, 'pointermove');
    if (moveHit) {
      dispatchNodeEvent(moveHit.node, 'pointermove', {
        originalEvent: event,
        detail: {
          instanceId: moveHit.instanceId,
          point: moveHit.point
        }
      });
    }

    const hit = pickCanvasTarget(event);
    const nextTarget = hit?.target ?? null;

    if (sameInteractionTarget(hoveredTarget, nextTarget)) return;

    if (hoveredTarget) {
      dispatchNodeEvent(hoveredTarget.node, 'pointerleave', {
        originalEvent: event,
        detail: {
          instanceId: hoveredTarget.instanceId
        }
      });
    }

    if (hit) {
      dispatchNodeEvent(hit.node, 'pointerenter', {
        originalEvent: event,
        detail: {
          instanceId: hit.instanceId,
          point: hit.point
        }
      });
    }

    hoveredTarget = nextTarget;
  }

  function pickCanvasTarget(event: MouseEvent, type?: string): TypeGpuInteractionHit | null {
    if (!currentScene) return null;

    const { x, y } = canvasPointFromEvent(canvas, event);

    return currentScene.interaction.pick({
      x,
      y,
      viewport: canvasViewport(canvas),
      camera: currentScene.camera,
      type
    });
  }

  canvas.addEventListener('click', dispatchCanvasClick);
  canvas.addEventListener('pointermove', dispatchCanvasPointerMove);

  return {
    scheduleSync,
    dispose() {
      cameraInteraction.dispose();
      canvas.removeEventListener('click', dispatchCanvasClick);
      canvas.removeEventListener('pointermove', dispatchCanvasPointerMove);
      gpu.dispose();
    }
  };
}

function canvasPointFromEvent(canvas: HTMLCanvasElement, event: MouseEvent): { x: number; y: number } {
  if (Number.isFinite(event.offsetX) && Number.isFinite(event.offsetY)) {
    return { x: event.offsetX, y: event.offsetY };
  }

  const rect =
    typeof canvas.getBoundingClientRect === 'function'
      ? canvas.getBoundingClientRect()
      : { left: 0, top: 0 };

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function canvasViewport(canvas: HTMLCanvasElement): { width: number; height: number } {
  return {
    width: positiveSize(canvas.clientWidth) ?? positiveSize(canvas.width) ?? 1,
    height: positiveSize(canvas.clientHeight) ?? positiveSize(canvas.height) ?? 1
  };
}

function positiveSize(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function sameInteractionTarget(
  previous: TypeGpuInteractionTarget | null,
  next: TypeGpuInteractionTarget | null
): boolean {
  return previous?.node === next?.node && previous?.instanceId === next?.instanceId;
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
