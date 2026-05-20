import { createRenderer } from 'svelte/renderer';
import {
  Camera,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer
} from 'three';
import { createFrameScheduler } from '../frame-scheduler';
import {
  addEventListener,
  createComment,
  createElement,
  createFragment,
  createTextNode,
  dispatchNodeEvent,
  findFirstCamera,
  findFirstScene,
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
  type ThreeNode,
  type ThreeRuntime
} from './core';

export interface ThreeRootOptions {
  target: HTMLElement;
  canvas?: HTMLCanvasElement;
  onFrame?: (timestamp: number) => void;
}

export type ThreeRoot = ThreeNode & {
  canvas: HTMLCanvasElement;
  webgl: WebGLRenderer;
  setContinuous(active: boolean): void;
  dispose(): void;
};

interface RuntimeState extends ThreeRuntime {
  scene: Scene | null;
  camera: Camera | null;
  invalidate(): void;
  setContinuous(active: boolean): void;
  dispose(): void;
}

const renderer = createRenderer({
  createFragment,
  createElement,
  createTextNode,
  createComment,
  nodeType(node: ThreeNode) {
    return node.kind;
  },
  getNodeValue(node: ThreeNode) {
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

export function createThreeRoot({
  target,
  canvas = document.createElement('canvas'),
  onFrame
}: ThreeRootOptions) {
  canvas.className = 'three-root-canvas';
  if (!canvas.parentNode) target.append(canvas);

  const webgl = new WebGLRenderer({ canvas, antialias: true });
  webgl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const root = createFragment() as ThreeRoot;
  const runtime = createRuntime(root, target, canvas, webgl, onFrame);
  root.runtime = runtime;
  root.canvas = canvas;
  root.webgl = webgl;
  root.setContinuous = runtime.setContinuous;
  root.dispose = runtime.dispose;

  runtime.sync(root);
  runtime.invalidate();

  return root;
}

function createRuntime(
  root: ThreeNode,
  target: HTMLElement,
  canvas: HTMLCanvasElement,
  webgl: WebGLRenderer,
  onFrame: ((timestamp: number) => void) | undefined
): RuntimeState {
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let scene: Scene | null = null;
  let camera: Camera | null = null;
  const scheduler = createFrameScheduler({
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (handle) => window.cancelAnimationFrame(handle),
    render(timestamp) {
      if (scene && camera) {
        webgl.render(scene, camera);
        onFrame?.(timestamp);
      }
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    resize();
    invalidate();
  });

  function sync(nextRoot: ThreeNode) {
    scene = findFirstScene(nextRoot);
    camera = findFirstCamera(nextRoot);
    resize();
  }

  function resize() {
    const width = Math.max(1, target.clientWidth || window.innerWidth);
    const height = Math.max(1, target.clientHeight || window.innerHeight);
    webgl.setSize(width, height, false);

    if (camera instanceof PerspectiveCamera) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  function invalidate() {
    scheduler.invalidate();
  }

  function dispatchPointerEvent(event: PointerEvent | MouseEvent) {
    if (!scene || !camera) return;

    const rect = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const intersections = raycaster.intersectObjects(scene.children, true);
    for (const intersection of intersections) {
      const node = findInteractiveNode(intersection.object, event.type);
      if (node) {
        dispatchNodeEvent(node, event.type, {
          originalEvent: event,
          detail: { intersection, intersections }
        });
        break;
      }
    }
  }

  function dispose() {
    scheduler.dispose();
    resizeObserver.disconnect();
    canvas.removeEventListener('click', dispatchPointerEvent);
    canvas.removeEventListener('pointermove', dispatchPointerEvent);
    webgl.dispose();
  }

  resizeObserver.observe(target);
  canvas.addEventListener('click', dispatchPointerEvent);
  canvas.addEventListener('pointermove', dispatchPointerEvent);

  return {
    get scene() {
      return scene;
    },
    get camera() {
      return camera;
    },
    sync,
    invalidate,
    setContinuous(active: boolean) {
      scheduler.setContinuous(active);
    },
    dispose
  };
}

function findInteractiveNode(object: Object3D, type: string): ThreeNode | null {
  let current: Object3D | null = object;

  while (current) {
    const node = current.userData.__svelteThreeNode as ThreeNode | undefined;
    if (node?.listeners.get(type)?.size) return node;
    current = current.parent;
  }

  return null;
}
