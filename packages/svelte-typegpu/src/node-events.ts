import type { TypeGpuNode } from './core';

export const BUBBLING_NODE_EVENTS = new Set([
  'click',
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
}

export function dispatchNodeEvent(
  node: TypeGpuNode,
  type: string,
  init: TypeGpuNodeEventInit = {}
): void {
  if (!(init.bubbles ?? BUBBLING_NODE_EVENTS.has(type)) && !node.listeners.get(type)?.size) return;
  const event = new NodeEvent(node, type, init);
  const path: TypeGpuNode[] = [node];
  if (event.bubbles) {
    for (let parent = node.parent; parent; parent = parent.parent) path.push(parent);
  }
  try {
    for (const current of path) {
      const listeners = current.listeners.get(type);
      if (listeners?.size) {
        event.currentTarget = current;
        for (const handler of [...listeners]) {
          if (!listeners.has(handler)) continue;
          handler(event);
          if (event.immediatePropagationStopped) break;
        }
      }
      if (event.propagationStopped) break;
    }
  } finally {
    event.currentTarget = null;
  }
}
