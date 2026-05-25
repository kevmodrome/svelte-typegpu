import { createRenderer } from 'svelte/renderer';
import { createCameraInteractionController } from './camera-interaction';
import {
  createTypeGpuRenderer,
  type TypeGpuRenderer,
  type TypeGpuRendererOptions
} from './gpu-renderer';
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
import type {
  TypeGpuDragEventDetail,
  TypeGpuInteractionHit,
  TypeGpuInteractionTarget,
  TypeGpuSceneState,
  Vector3Tuple
} from './types';

export interface TypeGpuRootOptions
  extends Pick<
    TypeGpuRendererOptions,
    'frameloop' | 'maxDevicePixelRatio' | 'clearColor' | 'depth' | 'alphaMode'
  > {
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

interface ActiveObjectDrag {
  target: TypeGpuInteractionTarget;
  node: TypeGpuNode;
  instanceId: TypeGpuInteractionHit['instanceId'];
  point: Vector3Tuple;
  pointerId: number;
  pointerType: string;
  button: number;
  startCanvas: { x: number; y: number };
  previousCanvas: { x: number; y: number };
  startClient: { x: number; y: number };
  previousClient: { x: number; y: number };
  moved: boolean;
}

const DRAG_EVENT_TYPES = ['dragstart', 'dragmove', 'dragend'] as const;

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
  onFps,
  frameloop,
  maxDevicePixelRatio,
  clearColor,
  depth,
  alphaMode
}: TypeGpuRootOptions): Promise<TypeGpuRoot> {
  canvas.className = 'renderer-root-canvas';
  if (!canvas.parentNode) target.append(canvas);

  const gpu = await createTypeGpuRenderer({
    canvas,
    onFps,
    frameloop,
    maxDevicePixelRatio,
    clearColor,
    depth,
    alphaMode
  });
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
  let activeDrag: ActiveObjectDrag | null = null;
  let suppressNextDragClick = false;
  const cameraInteraction = createCameraInteractionController({
    canvas,
    renderer: gpu,
    windowTarget: options.windowTarget,
    shouldIgnorePointerDragStart: () => activeDrag !== null
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
    if (suppressNextDragClick) {
      suppressNextDragClick = false;
      return;
    }

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

  function dispatchCanvasPointerDown(event: PointerEvent) {
    const pointerHit = pickCanvasTarget(event, 'pointerdown');
    if (pointerHit) {
      dispatchNodeEvent(pointerHit.node, 'pointerdown', {
        originalEvent: event,
        detail: {
          instanceId: pointerHit.instanceId,
          point: pointerHit.point
        }
      });
    }

    if (activeDrag) return;

    const hit = pickCanvasTarget(event);
    if (!hit || !hasDragHandler(hit.target)) return;

    event.preventDefault();
    activeDrag = createActiveDrag(hit, event);
    capturePointer(canvas, activeDrag.pointerId);
    dispatchDragEvent('dragstart', event);
  }

  function dispatchCanvasPointerMove(event: PointerEvent) {
    if (dispatchActiveDragMove(event)) return;

    const hit = pickCanvasTarget(event);
    updateHoveredTarget(hit, event);

    if (hit?.target.handlers.has('pointermove')) {
      dispatchNodeEvent(hit.node, 'pointermove', {
        originalEvent: event,
        detail: {
          instanceId: hit.instanceId,
          point: hit.point
        }
      });
    }
  }

  function dispatchCanvasPointerUp(event: PointerEvent) {
    if (finishActiveDrag(event, false)) return;

    const hit = pickCanvasTarget(event, 'pointerup');
    if (!hit) return;

    dispatchNodeEvent(hit.node, 'pointerup', {
      originalEvent: event,
      detail: {
        instanceId: hit.instanceId,
        point: hit.point
      }
    });
  }

  function dispatchCanvasPointerCancel(event: PointerEvent) {
    finishActiveDrag(event, true);
  }

  function updateHoveredTarget(hit: TypeGpuInteractionHit | null, event: PointerEvent) {
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

  function dispatchCanvasPointerExit(event: PointerEvent) {
    if (activeDrag) return;
    if (!hoveredTarget) return;

    dispatchNodeEvent(hoveredTarget.node, 'pointerleave', {
      originalEvent: event,
      detail: {
        instanceId: hoveredTarget.instanceId
      }
    });
    hoveredTarget = null;
  }

  function createActiveDrag(hit: TypeGpuInteractionHit, event: PointerEvent): ActiveObjectDrag {
    const canvasPoint = canvasPointFromEvent(canvas, event);
    const clientPoint = clientPointFromEvent(event);

    return {
      target: hit.target,
      node: hit.node,
      instanceId: hit.instanceId,
      point: hit.point,
      pointerId: pointerIdFromEvent(event),
      pointerType: pointerTypeFromEvent(event),
      button: finiteNumber(event.button, 0),
      startCanvas: canvasPoint,
      previousCanvas: canvasPoint,
      startClient: clientPoint,
      previousClient: clientPoint,
      moved: false
    };
  }

  function dispatchActiveDragMove(event: PointerEvent): boolean {
    if (!activeDrag || !samePointer(event, activeDrag)) return false;

    event.preventDefault();
    const nextCanvas = canvasPointFromEvent(canvas, event);
    if (
      nextCanvas.x !== activeDrag.previousCanvas.x ||
      nextCanvas.y !== activeDrag.previousCanvas.y
    ) {
      activeDrag.moved = true;
    }
    dispatchDragEvent('dragmove', event);
    activeDrag.previousCanvas = nextCanvas;
    activeDrag.previousClient = clientPointFromEvent(event);
    return true;
  }

  function finishActiveDrag(event: PointerEvent, cancelled: boolean): boolean {
    if (!activeDrag || !samePointer(event, activeDrag)) return false;

    event.preventDefault();
    const endCanvas = canvasPointFromEvent(canvas, event);
    const moved =
      activeDrag.moved ||
      endCanvas.x !== activeDrag.startCanvas.x ||
      endCanvas.y !== activeDrag.startCanvas.y;
    suppressNextDragClick = suppressNextDragClick || moved;
    dispatchDragEvent('dragend', event, cancelled);
    releasePointer(canvas, activeDrag.pointerId);
    activeDrag = null;
    return true;
  }

  function dispatchDragEvent(
    type: (typeof DRAG_EVENT_TYPES)[number],
    event: PointerEvent,
    cancelled = false
  ) {
    if (!activeDrag || !activeDrag.target.handlers.has(type)) return;

    dispatchNodeEvent(activeDrag.node, type, {
      originalEvent: event,
      detail: dragEventDetail(canvas, activeDrag, event, cancelled)
    });
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
  canvas.addEventListener('pointerdown', dispatchCanvasPointerDown);
  canvas.addEventListener('pointermove', dispatchCanvasPointerMove);
  canvas.addEventListener('pointerup', dispatchCanvasPointerUp);
  canvas.addEventListener('pointercancel', dispatchCanvasPointerCancel);
  canvas.addEventListener('pointerleave', dispatchCanvasPointerExit);
  canvas.addEventListener('pointerout', dispatchCanvasPointerExit);

  return {
    scheduleSync,
    dispose() {
      cameraInteraction.dispose();
      canvas.removeEventListener('click', dispatchCanvasClick);
      canvas.removeEventListener('pointerdown', dispatchCanvasPointerDown);
      canvas.removeEventListener('pointermove', dispatchCanvasPointerMove);
      canvas.removeEventListener('pointerup', dispatchCanvasPointerUp);
      canvas.removeEventListener('pointercancel', dispatchCanvasPointerCancel);
      canvas.removeEventListener('pointerleave', dispatchCanvasPointerExit);
      canvas.removeEventListener('pointerout', dispatchCanvasPointerExit);
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

function clientPointFromEvent(event: PointerEvent): { x: number; y: number } {
  return {
    x: finiteNumber(event.clientX, 0),
    y: finiteNumber(event.clientY, 0)
  };
}

function dragEventDetail(
  canvas: HTMLCanvasElement,
  activeDrag: ActiveObjectDrag,
  event: PointerEvent,
  cancelled: boolean
): TypeGpuDragEventDetail {
  const canvasPoint = canvasPointFromEvent(canvas, event);
  const clientPoint = clientPointFromEvent(event);
  const deltaX = canvasPoint.x - activeDrag.previousCanvas.x;
  const deltaY = canvasPoint.y - activeDrag.previousCanvas.y;

  return {
    mode: activeDrag.target.drag,
    instanceId: activeDrag.instanceId,
    point: activeDrag.point,
    pointerId: activeDrag.pointerId,
    pointerType: pointerTypeFromEvent(event, activeDrag.pointerType),
    button: finiteNumber(event.button, activeDrag.button),
    buttons: finiteNumber(event.buttons, 0),
    x: canvasPoint.x,
    y: canvasPoint.y,
    startX: activeDrag.startCanvas.x,
    startY: activeDrag.startCanvas.y,
    previousX: activeDrag.previousCanvas.x,
    previousY: activeDrag.previousCanvas.y,
    clientX: clientPoint.x,
    clientY: clientPoint.y,
    startClientX: activeDrag.startClient.x,
    startClientY: activeDrag.startClient.y,
    previousClientX: activeDrag.previousClient.x,
    previousClientY: activeDrag.previousClient.y,
    deltaX,
    deltaY,
    movementX: deltaX,
    movementY: deltaY,
    totalDeltaX: canvasPoint.x - activeDrag.startCanvas.x,
    totalDeltaY: canvasPoint.y - activeDrag.startCanvas.y,
    cancelled
  };
}

function positiveSize(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? value! : fallback;
}

function sameInteractionTarget(
  previous: TypeGpuInteractionTarget | null,
  next: TypeGpuInteractionTarget | null
): boolean {
  return previous?.node === next?.node && previous?.instanceId === next?.instanceId;
}

function hasDragHandler(target: TypeGpuInteractionTarget): boolean {
  return DRAG_EVENT_TYPES.some((type) => target.handlers.has(type));
}

function samePointer(event: PointerEvent, activeDrag: ActiveObjectDrag): boolean {
  return pointerIdFromEvent(event) === activeDrag.pointerId;
}

function pointerIdFromEvent(event: PointerEvent): number {
  return finiteNumber(event.pointerId, 1);
}

function pointerTypeFromEvent(event: PointerEvent, fallback = 'mouse'): string {
  return typeof event.pointerType === 'string' && event.pointerType.length > 0
    ? event.pointerType
    : fallback;
}

function capturePointer(canvas: HTMLCanvasElement, pointerId: number): void {
  try {
    canvas.setPointerCapture?.(pointerId);
  } catch {
    // Browser implementations can reject stale pointer ids; drag dispatch still works on-canvas.
  }
}

function releasePointer(canvas: HTMLCanvasElement, pointerId: number): void {
  try {
    canvas.releasePointerCapture?.(pointerId);
  } catch {
    // Ignore stale pointer releases for parity with pointer capture best effort.
  }
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
