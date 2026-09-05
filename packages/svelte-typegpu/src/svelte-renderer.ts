import { createRenderer } from 'svelte/renderer';
import { flushSync } from 'svelte';
import { FrameTasks } from './frame-tasks';
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
  walk,
  type TypeGpuNode,
  type TypeGpuRuntime
} from './core';
import { Dirty } from './dirty';
import { dispatchNodeEventOnPath } from './node-events';
import { createSceneState, createTypeGpuSceneCache } from './scene-state';
import { createModelCache, type TypeGpuModelCacheOptions } from './model-cache';
import type {
  TypeGpuDragEventDetail,
  TypeGpuInteractionHit,
  TypeGpuInteractionTarget,
  TypeGpuPointerDragButton,
  TypeGpuSceneState,
  TypeGpuRenderSettings,
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
  /** Used by declarative viewports; legacy roots retain their existing scene semantics. */
  scenePolicy?: 'single';
  onSceneError?: (error: Error) => void;
}

export type TypeGpuRoot = TypeGpuNode & {
  canvas: HTMLCanvasElement;
  gpu: TypeGpuRenderer;
  dispose(): void;
};

interface RuntimeState extends TypeGpuRuntime {
  dispose(): void;
}

type ListenerTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;
type ListenerRegistration = [string, EventListener];

interface RuntimeOptions {
  scenePolicy?: 'single';
  onSceneError?: (error: Error) => void;
  renderDefaults?: Partial<TypeGpuRenderSettings>;
  windowTarget?: ListenerTarget;
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
  alphaMode,
  scenePolicy,
  onSceneError
}: TypeGpuRootOptions): Promise<TypeGpuRoot> {
  canvas.classList.add('renderer-root-canvas');
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
  const runtime = createRuntime(root, canvas, gpu, {
    renderDefaults: { clearColor, depth, alphaMode }, scenePolicy, onSceneError
  });

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
  let disposed = false;
  let queued = false;
  let dirty = Dirty.All;
  let dirtyNodes = new Map<TypeGpuNode, Dirty>();
  let fullSync = false;
  const frameTasks = new FrameTasks();
  const onModelSettled = () => scheduleSync(root);
  const hasInjectedModelLoader = Boolean(options.loadUrl || options.loadData);
  const sceneCache = createTypeGpuSceneCache({
    renderDefaults: options.renderDefaults,
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
  let objectDragWindowListenersAttached = false;
  let suppressNextDragClick = false;
  const objectDragWindowTarget = windowTargetForObjectDrag(options.windowTarget);
  const cameraInteraction = createCameraInteractionController({
    canvas,
    renderer: gpu,
    windowTarget: options.windowTarget,
    shouldIgnorePointerDragStart: () => activeDrag !== null
  });
  let currentScene: TypeGpuSceneState | null = null;
  let hoveredTarget: TypeGpuInteractionTarget | null = null;
  let hoveredPath: TypeGpuNode[] = [];
  let wheelListening = false;

  gpu.setFrameHandler?.((frame) => {
    if (disposed) return false;
    flushSync();
    flushScene();
    if (disposed) return false;
    flushSync(() => frameTasks.run(frame));
    flushScene();
    return !disposed && frameTasks.continuous;
  });

  function scheduleSync(
    nextRoot: TypeGpuNode,
    dirtyNode?: TypeGpuNode,
    dirtyMask: Dirty = Dirty.All
  ) {
    if (disposed) return;
    root = nextRoot;
    dirty = (dirty | dirtyMask) as Dirty;
    if (dirtyNode) {
      dirtyNodes.set(dirtyNode, (dirtyNodes.get(dirtyNode) ?? Dirty.None) | dirtyMask);
    } else {
      fullSync = true;
    }

    if (queued) return;

    queued = true;
    queueMicrotask(() => {
      queued = false;
      flushScene();
    });
  }

  function flushScene() {
    if (disposed || dirty === Dirty.None) return;
    const sceneDirty = dirty;
    const sceneNodes = fullSync ? undefined : dirtyNodes;
    dirty = Dirty.None;
    dirtyNodes = new Map();
    fullSync = false;
    if (options.scenePolicy === 'single' && (sceneDirty & Dirty.Tree) !== 0) {
      let scenes = 0;
      walk(root, (node) => { if (node.name === 'scene') scenes++; });
      if (scenes > 1) {
        const error = new Error('A TypeGPU canvas supports at most one mounted <scene>. Use {#if} to switch scenes.');
        if (options.onSceneError) options.onSceneError(error);
        else throw error;
        return;
      }
    }
    if ((sceneDirty & (Dirty.FrameTasks | Dirty.Tree)) !== 0) frameTasks.reconcile(root);
    const scene = createSceneState(root, sceneCache, {
      dirty: sceneDirty,
      dirtyNodes: sceneNodes
    });
    gpu.setScene(scene);
    if (scene.interaction !== currentScene?.interaction) {
      setWheelListening(scene.interaction.targets.some((target) => target.handlers.has('wheel')));
    }
    cameraInteraction.reconcile(scene);
    currentScene = scene;
  }

  function setWheelListening(listening: boolean) {
    if (wheelListening === listening) return;
    wheelListening = listening;
    if (listening) {
      // Scene cancellation must precede camera zoom, including late subscriptions.
      canvas.addEventListener('wheel', dispatchCanvasPickedEvent, { capture: true, passive: false });
    } else {
      canvas.removeEventListener('wheel', dispatchCanvasPickedEvent, true);
    }
  }

  function dispatchCanvasClick(event: MouseEvent) {
    if (suppressNextDragClick) {
      suppressNextDragClick = false;
      return;
    }

    if (cameraInteraction.consumeSuppressedClick()) return;

    dispatchCanvasPickedEvent(event);
  }

  function dispatchCanvasPickedEvent(event: MouseEvent) {
    const hit = pickCanvasTarget(event, event.type);
    if (!hit) return;

    dispatchNodeEvent(hit.node, event.type, {
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

    if (disposed || activeDrag) return;

    const hit = pickCanvasTarget(event);
    if (!hit || !hasDragHandler(hit.target)) return;
    if (!objectDragButtonMatches(hit.target.dragButton, event)) return;

    event.preventDefault();
    const drag = activeDrag = createActiveDrag(hit, event);
    try {
      capturePointer(canvas, drag.pointerId);
      attachObjectDragWindowListeners();
      dispatchDragEvent('dragstart', event);
    } catch (error) {
      releaseActiveDrag(drag);
      throw error;
    }
  }

  function dispatchCanvasPointerMove(event: PointerEvent) {
    if (dispatchActiveDragMove(event)) return;

    const hit = pickCanvasTarget(event);
    if (!updateHoveredTarget(hit, event)) return;

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

  function dispatchCanvasPointerEntry(event: PointerEvent) {
    if (activeDrag) return;
    updateHoveredTarget(pickCanvasTarget(event), event);
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

  function dispatchCanvasLostPointerCapture(event: PointerEvent) {
    finishActiveDrag(event, true, { releasePointerCapture: false });
  }

  function dispatchWindowPointerUp(event: Event) {
    finishActiveDrag(event as PointerEvent, false);
  }

  function dispatchWindowPointerCancel(event: Event) {
    finishActiveDrag(event as PointerEvent, true);
  }

  function updateHoveredTarget(hit: TypeGpuInteractionHit | null, event: PointerEvent) {
    const nextTarget = hit?.target ?? null;
    if (sameInteractionTarget(hoveredTarget, nextTarget)) {
      let node = nextTarget?.node ?? null;
      let index = 0;
      while (node && hoveredPath[index] === node) {
        node = node.parent;
        index++;
      }
      if (!node && index === hoveredPath.length) return true;
    }

    // Retain the old ancestry across reparenting; allocate only on hover transitions.
    const previousTarget = hoveredTarget;
    const previousPath = hoveredPath;
    const nextPath: TypeGpuNode[] = [];
    for (let node = nextTarget?.node; node; node = node.parent ?? undefined) nextPath.push(node);
    let common = 0;
    while (
      common < previousPath.length && common < nextPath.length &&
      previousPath[previousPath.length - common - 1] === nextPath[nextPath.length - common - 1]
    ) common++;
    // Separate primitives of one model retain leaf-level instance transitions.
    if (previousTarget && nextTarget && previousTarget.node === nextTarget.node &&
        previousTarget.instanceId !== nextTarget.instanceId && common === nextPath.length) common--;
    hoveredTarget = nextTarget;
    hoveredPath = nextPath;

    if (previousTarget) {
      dispatchNodeEventOnPath(previousPath, 'pointerout', {
        originalEvent: event,
        relatedTarget: nextTarget?.node ?? null,
        detail: { instanceId: previousTarget.instanceId }
      });
      if (disposed || hoveredPath !== nextPath) return false;
    }
    for (let i = 0; i < previousPath.length - common; i++) {
      dispatchNodeEvent(previousPath[i], 'pointerleave', {
        originalEvent: event,
        relatedTarget: nextTarget?.node ?? null,
        detail: { instanceId: previousTarget!.instanceId }
      });
      if (disposed || hoveredPath !== nextPath) return false;
    }
    if (hit) {
      dispatchNodeEventOnPath(nextPath, 'pointerover', {
        originalEvent: event,
        relatedTarget: previousTarget?.node ?? null,
        detail: { instanceId: hit.instanceId, point: hit.point }
      });
      if (disposed || hoveredPath !== nextPath) return false;
    }
    for (let i = nextPath.length - common - 1; i >= 0; i--) {
      dispatchNodeEvent(nextPath[i], 'pointerenter', {
        originalEvent: event,
        relatedTarget: previousTarget?.node ?? null,
        detail: { instanceId: hit!.instanceId, point: hit!.point }
      });
      if (disposed || hoveredPath !== nextPath) return false;
    }
    return true;
  }

  function dispatchCanvasPointerExit(event: PointerEvent) {
    if (activeDrag) return;
    updateHoveredTarget(null, event);
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
    const drag = activeDrag;
    if (!drag || !samePointer(event, drag)) return false;

    event.preventDefault();
    const nextCanvas = canvasPointFromEvent(canvas, event);
    if (
      nextCanvas.x !== drag.previousCanvas.x ||
      nextCanvas.y !== drag.previousCanvas.y
    ) {
      drag.moved = true;
    }
    dispatchDragEvent('dragmove', event);
    if (activeDrag === drag) {
      drag.previousCanvas = nextCanvas;
      drag.previousClient = clientPointFromEvent(event);
    }
    return true;
  }

  function releaseActiveDrag(drag: ActiveObjectDrag, releaseCapture = true) {
    if (activeDrag !== drag) return;
    activeDrag = null;
    detachObjectDragWindowListeners();
    if (releaseCapture) releasePointer(canvas, drag.pointerId);
  }

  function finishActiveDrag(
    event: PointerEvent,
    cancelled: boolean,
    options: { releasePointerCapture?: boolean } = {}
  ): boolean {
    const drag = activeDrag;
    if (!drag || !samePointer(event, drag)) return false;

    event.preventDefault();
    const endCanvas = canvasPointFromEvent(canvas, event);
    const moved =
      drag.moved ||
      endCanvas.x !== drag.startCanvas.x ||
      endCanvas.y !== drag.startCanvas.y;
    suppressNextDragClick = suppressNextDragClick || moved;

    // Terminal callbacks may dispose the runtime or start a replacement gesture.
    releaseActiveDrag(drag, options.releasePointerCapture !== false);
    if (!cancelled) dispatchCapturedPointerUp(drag, event);
    if (!disposed) dispatchDragEventFor(drag, 'dragend', event, cancelled);

    return true;
  }

  function dispatchDragEvent(
    type: (typeof DRAG_EVENT_TYPES)[number],
    event: PointerEvent,
    cancelled = false
  ) {
    if (!activeDrag) return;
    dispatchDragEventFor(activeDrag, type, event, cancelled);
  }

  function dispatchDragEventFor(
    drag: ActiveObjectDrag,
    type: (typeof DRAG_EVENT_TYPES)[number],
    event: PointerEvent,
    cancelled = false
  ) {
    if (!drag.target.handlers.has(type)) return;

    dispatchNodeEvent(drag.node, type, {
      originalEvent: event,
      detail: dragEventDetail(canvas, drag, event, cancelled)
    });
  }

  function dispatchCapturedPointerUp(drag: ActiveObjectDrag, event: PointerEvent) {
    if (!drag.target.handlers.has('pointerup')) return;

    dispatchNodeEvent(drag.node, 'pointerup', {
      originalEvent: event,
      detail: {
        instanceId: drag.instanceId,
        point: drag.point
      }
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
  canvas.addEventListener('dblclick', dispatchCanvasPickedEvent);
  canvas.addEventListener('contextmenu', dispatchCanvasPickedEvent);
  canvas.addEventListener('pointerdown', dispatchCanvasPointerDown);
  canvas.addEventListener('pointerover', dispatchCanvasPointerEntry);
  canvas.addEventListener('pointermove', dispatchCanvasPointerMove);
  canvas.addEventListener('pointerup', dispatchCanvasPointerUp);
  canvas.addEventListener('pointercancel', dispatchCanvasPointerCancel);
  canvas.addEventListener('lostpointercapture', dispatchCanvasLostPointerCapture);
  canvas.addEventListener('pointerleave', dispatchCanvasPointerExit);
  canvas.addEventListener('pointerout', dispatchCanvasPointerExit);

  const objectDragWindowListeners: ListenerRegistration[] = [
    ['pointerup', dispatchWindowPointerUp],
    ['pointercancel', dispatchWindowPointerCancel]
  ];

  function attachObjectDragWindowListeners(): void {
    if (!objectDragWindowTarget || objectDragWindowListenersAttached) return;

    for (const [type, listener] of objectDragWindowListeners) {
      objectDragWindowTarget.addEventListener(type, listener);
    }

    objectDragWindowListenersAttached = true;
  }

  function detachObjectDragWindowListeners(): void {
    if (!objectDragWindowTarget || !objectDragWindowListenersAttached) return;

    for (const [type, listener] of objectDragWindowListeners) {
      objectDragWindowTarget.removeEventListener(type, listener);
    }

    objectDragWindowListenersAttached = false;
  }

  return {
    scheduleSync,
    dispose() {
      if (disposed) return;
      disposed = true;
      frameTasks.clear();
      gpu.setFrameHandler?.(null);
      dirtyNodes.clear();
      sceneCache.transforms.reset(root);
      sceneCache.values.reset();
      sceneCache.lastState = undefined;
      sceneCache.resourceItems = [];
      sceneCache.cleanDrawBatches = [];
      sceneCache.cleanInteraction = { targets: [], pick: () => null };
      currentScene = null;
      hoveredTarget = null;
      hoveredPath = [];
      setWheelListening(false);
      cameraInteraction.dispose();
      canvas.removeEventListener('click', dispatchCanvasClick);
      canvas.removeEventListener('dblclick', dispatchCanvasPickedEvent);
      canvas.removeEventListener('contextmenu', dispatchCanvasPickedEvent);
      canvas.removeEventListener('pointerdown', dispatchCanvasPointerDown);
      canvas.removeEventListener('pointerover', dispatchCanvasPointerEntry);
      canvas.removeEventListener('pointermove', dispatchCanvasPointerMove);
      canvas.removeEventListener('pointerup', dispatchCanvasPointerUp);
      canvas.removeEventListener('pointercancel', dispatchCanvasPointerCancel);
      canvas.removeEventListener('lostpointercapture', dispatchCanvasLostPointerCapture);
      canvas.removeEventListener('pointerleave', dispatchCanvasPointerExit);
      canvas.removeEventListener('pointerout', dispatchCanvasPointerExit);
      detachObjectDragWindowListeners();
      if (activeDrag) releaseActiveDrag(activeDrag);
      gpu.dispose();
    }
  };
}

function canvasPointFromEvent(canvas: HTMLCanvasElement, event: MouseEvent): { x: number; y: number } {
  if (isCanvasEvent(canvas, event) && Number.isFinite(event.offsetX) && Number.isFinite(event.offsetY)) {
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

function isCanvasEvent(canvas: HTMLCanvasElement, event: Event): boolean {
  return event.currentTarget === canvas || event.target === canvas;
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

function objectDragButtonMatches(
  dragButton: TypeGpuPointerDragButton | undefined,
  event: PointerEvent
): boolean {
  if (event.pointerType && event.pointerType !== 'mouse') return true;

  return finiteNumber(event.button, 0) === buttonNumber(dragButton ?? 'primary');
}

function buttonNumber(button: TypeGpuPointerDragButton): number {
  if (button === 'middle') return 1;
  if (button === 'secondary') return 2;
  return 0;
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

function windowTargetForObjectDrag(windowTarget?: ListenerTarget): ListenerTarget | null {
  if (windowTarget) return windowTarget;

  return typeof globalThis.window === 'undefined' ? null : globalThis.window;
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
