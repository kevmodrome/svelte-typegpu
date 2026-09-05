import type { TypeGpuNode } from './core';

export const BUBBLING_NODE_EVENTS = new Set([
  'click',
  'dblclick',
  'contextmenu',
  'pointerdown',
  'pointerup',
  'pointermove',
  'dragstart',
  'dragmove',
  'dragend'
]);
export const POINTER_NODE_EVENTS = new Set([
  ...BUBBLING_NODE_EVENTS,
  'pointerenter',
  'pointerleave'
]);

export type TypeGpuEventListenerOptions = boolean | { capture?: boolean };
export type TypeGpuNodeEventHandler = (this: TypeGpuNode, event: TypeGpuNodeEvent) => void;

export function captureOption(options: TypeGpuEventListenerOptions = false): boolean {
  return typeof options === 'boolean' ? options : options.capture === true;
}

export interface TypeGpuNodeEventInit {
  detail?: unknown;
  originalEvent?: Event;
  relatedTarget?: TypeGpuNode | null;
  bubbles?: boolean;
  cancelable?: boolean;
}

export interface TypeGpuNodeEvent {
  readonly type: string;
  readonly target: TypeGpuNode;
  readonly currentTarget: TypeGpuNode | null;
  readonly eventPhase: 0 | 1 | 2 | 3;
  readonly detail?: unknown;
  readonly originalEvent?: Event;
  readonly relatedTarget: TypeGpuNode | null;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly defaultPrevented: boolean;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  preventDefault(): void;
}

class NodeEvent implements TypeGpuNodeEvent {
  readonly type: string;
  readonly target: TypeGpuNode;
  currentTarget: TypeGpuNode | null = null;
  eventPhase: 0 | 1 | 2 | 3 = 0;
  readonly detail?: unknown;
  readonly originalEvent?: Event;
  readonly relatedTarget: TypeGpuNode | null;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  propagationStopped = false;
  immediatePropagationStopped = false;
  #defaultPrevented = false;

  constructor(node: TypeGpuNode, type: string, init: TypeGpuNodeEventInit) {
    // Preserve extra payload fields used by low-level custom event dispatchers.
    Object.assign(this, init);
    this.type = type;
    this.target = node;
    this.bubbles = init.bubbles ?? BUBBLING_NODE_EVENTS.has(type);
    this.cancelable = init.cancelable ?? init.originalEvent?.cancelable ?? true;
    this.relatedTarget = init.relatedTarget ?? null;
  }

  get defaultPrevented(): boolean {
    return this.#defaultPrevented || this.originalEvent?.defaultPrevented === true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
  stopImmediatePropagation(): void {
    this.propagationStopped = true;
    this.immediatePropagationStopped = true;
  }
  preventDefault(): void {
    if (!this.cancelable) return;
    this.#defaultPrevented = true;
    this.originalEvent?.preventDefault();
  }

  invoke(current: TypeGpuNode, capture: boolean): void {
    const listeners = (capture ? current.captureListeners : current.listeners)?.get(this.type);
    if (!listeners?.size) return;
    this.currentTarget = current;
    this.eventPhase = current === this.target ? 2 : capture ? 1 : 3;
    for (const handler of [...listeners]) {
      if (!listeners.has(handler)) continue;
      handler.call(current, this);
      if (this.immediatePropagationStopped) break;
    }
  }
}

function hasCaptureListener(node: TypeGpuNode, type: string): boolean {
  for (let current: TypeGpuNode | null = node; current; current = current.parent) {
    if (current.captureListeners?.get(type)?.size) return true;
  }
  return false;
}

export function dispatchNodeEvent(
  node: TypeGpuNode,
  type: string,
  init: TypeGpuNodeEventInit = {}
): void {
  if (
    !(init.bubbles ?? BUBBLING_NODE_EVENTS.has(type)) &&
    !node.listeners.get(type)?.size &&
    !hasCaptureListener(node, type)
  )
    return;
  const event = new NodeEvent(node, type, init);
  const path: TypeGpuNode[] = [node];
  for (let parent = node.parent; parent; parent = parent.parent) path.push(parent);
  try {
    for (let i = path.length - 1; i >= 0; i--) {
      event.invoke(path[i], true);
      if (event.propagationStopped) return;
    }
    const length = event.bubbles ? path.length : 1;
    for (let i = 0; i < length; i++) {
      event.invoke(path[i], false);
      if (event.propagationStopped) break;
    }
  } finally {
    event.currentTarget = null;
    event.eventPhase = 0;
  }
}
