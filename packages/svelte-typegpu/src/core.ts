import { Dirty, mergeDirty } from './dirty';
import {
  captureOption,
  type TypeGpuEventListenerOptions,
  type TypeGpuNodeEventHandler,
  type TypeGpuNodeEventListener,
  type TypeGpuNodeEventRegistration,
  type TypeGpuNodeEventRegistry
} from './node-events';
export {
  dispatchNodeEvent,
  type TypeGpuEventListenerOptions,
  type TypeGpuNodeEvent,
  type TypeGpuNodeEventHandler,
  type TypeGpuNodeEventListener,
  type TypeGpuNodeEventInit
} from './node-events';
import {
  dirtyForAttribute,
  dirtyForEventListener,
  dirtyForInsert,
  dirtyForRemove,
  normalizePrimitiveName,
  sameAttributeValue
} from './primitives';

export type TypeGpuNodeKind = 'fragment' | 'element' | 'text' | 'comment';

export interface TypeGpuNode {
  kind: TypeGpuNodeKind;
  uid: number;
  revision: number;
  treeRevision: number;
  name?: string;
  originalName?: string;
  parent: TypeGpuNode | null;
  firstChild: TypeGpuNode | null;
  lastChild: TypeGpuNode | null;
  previousSibling: TypeGpuNode | null;
  nextSibling: TypeGpuNode | null;
  children: TypeGpuNode[];
  attributes: Record<string, unknown>;
  listeners: TypeGpuNodeEventRegistry;
  captureListeners?: TypeGpuNodeEventRegistry;
  runtime?: TypeGpuRuntime;
  value?: string;
}

let nextNodeUid = 1;

export interface TypeGpuRuntime {
  scheduleSync(root: TypeGpuNode, dirtyNode?: TypeGpuNode, dirtyMask?: Dirty): void;
}

export function createFragment(): TypeGpuNode {
  return createStub('fragment');
}

export function createElement(name: string): TypeGpuNode {
  const node = createStub('element');
  node.name = normalizePrimitiveName(name);
  node.originalName = name;
  return node;
}

export function createTextNode(value = ''): TypeGpuNode {
  const node = createStub('text');
  node.value = value;
  return node;
}

export function createComment(value = ''): TypeGpuNode {
  const node = createStub('comment');
  node.value = value;
  return node;
}

export function setAttribute(node: TypeGpuNode, key: string, value: unknown): void {
  const previous = node.attributes[key];
  if (sameAttributeValue(previous, value)) return;

  node.attributes[key] = value;
  node.revision += 1;
  invalidateFrom(node, dirtyForAttribute(node.name, key, previous, value));
}

export function removeAttribute(node: TypeGpuNode, key: string): void {
  if (!(key in node.attributes)) return;

  const previous = node.attributes[key];
  delete node.attributes[key];
  node.revision += 1;
  invalidateFrom(node, dirtyForAttribute(node.name, key, previous, undefined));
}

export function getAttribute(node: TypeGpuNode, key: string): string | null {
  const value = node.attributes[key];
  return value == null ? null : String(value);
}

export function hasAttribute(node: TypeGpuNode, key: string): boolean {
  return key in node.attributes;
}

export function insert(parent: TypeGpuNode, node: TypeGpuNode, anchor: TypeGpuNode | null): void {
  if (node.kind === 'fragment') {
    for (const child of childSnapshot(node)) {
      insert(parent, child, anchor);
    }
    return;
  }

  if (node === anchor) return;

  if (node.parent) {
    remove(node);
  }

  if (anchor && anchor.parent !== parent) {
    throw new Error('Anchor node is not a child of the target parent');
  }

  const previous = anchor ? anchor.previousSibling : parent.lastChild;
  const next = anchor;

  node.parent = parent;
  node.previousSibling = previous;
  node.nextSibling = next;

  if (previous) {
    previous.nextSibling = node;
  } else {
    parent.firstChild = node;
  }

  if (next) {
    next.previousSibling = node;
  } else {
    parent.lastChild = node;
  }

  const root = markTreeChanged(parent);
  invalidateRoot(root, node, dirtyForStructuralSubtree(node, dirtyForInsert));
}

export function remove(node: TypeGpuNode): void {
  if (!node.parent) return;

  const parent = node.parent;
  const previous = node.previousSibling;
  const next = node.nextSibling;
  const dirtyMask = dirtyForStructuralSubtree(node, dirtyForRemove);

  if (previous) {
    previous.nextSibling = next;
  } else {
    parent.firstChild = next;
  }

  if (next) {
    next.previousSibling = previous;
  } else {
    parent.lastChild = previous;
  }

  const root = markTreeChanged(parent);

  node.parent = null;
  node.previousSibling = null;
  node.nextSibling = null;
  invalidateRoot(root, node, dirtyMask);
}

export function getParent(node: TypeGpuNode): TypeGpuNode | null {
  return node.parent;
}

export function getFirstChild(node: TypeGpuNode): TypeGpuNode | null {
  return node.firstChild;
}

export function getLastChild(node: TypeGpuNode): TypeGpuNode | null {
  return node.lastChild;
}

export function getNextSibling(node: TypeGpuNode): TypeGpuNode | null {
  return node.nextSibling;
}

export function addEventListener(
  node: TypeGpuNode, type: string, handler: TypeGpuNodeEventHandler, options?: TypeGpuEventListenerOptions
): void;
export function addEventListener(
  node: TypeGpuNode, type: string, handler: TypeGpuNodeEventListener | null, options?: TypeGpuEventListenerOptions
): void;
export function addEventListener(
  node: TypeGpuNode,
  type: string,
  handler: TypeGpuNodeEventListener | null,
  options?: TypeGpuEventListenerOptions
): void {
  const capture = captureOption(options);
  const { once = false, passive = false, signal } = typeof options === 'object' ? options : {};
  if (!handler || signal?.aborted) return;
  const registry = capture
    ? (node.captureListeners ??= new Map())
    : node.listeners;
  const listeners = registry.get(type) ?? new Map();
  if (listeners.has(handler)) return;

  const registration: TypeGpuNodeEventRegistration = {
    listener: handler, once, passive, removed: false,
    remove: () => removeEventListener(node, type, handler, capture)
  };
  listeners.set(handler, registration);
  registry.set(type, listeners);
  if (signal) {
    // A synthetic 'abort' event does not abort its signal or consume this subscription.
    const abort = () => { if (signal.aborted) registration.remove(); };
    registration.detachSignal = () => signal.removeEventListener('abort', abort);
    try {
      signal.addEventListener('abort', abort);
    } catch (error) {
      registration.remove();
      throw error;
    }
  }
  if (registration.removed) return;
  invalidateFrom(node, dirtyForEventListener(node.name, type));
}

export function removeEventListener(
  node: TypeGpuNode,
  type: string,
  handler: TypeGpuNodeEventListener | null,
  options?: TypeGpuEventListenerOptions
): void {
  if (!handler) return;
  const capture = captureOption(options);
  const registry = capture ? node.captureListeners : node.listeners;
  const listeners = registry?.get(type);
  const registration = listeners?.get(handler);
  if (!registration) return;

  registration.removed = true;
  listeners!.delete(handler);
  if (listeners!.size === 0) {
    registry!.delete(type);
    if (capture && registry!.size === 0) delete node.captureListeners;
  }
  registration.detachSignal?.();
  registration.detachSignal = undefined;
  invalidateFrom(node, dirtyForEventListener(node.name, type));
}

export function setText(node: TypeGpuNode, value: string): void {
  if (node.kind === 'text' || node.kind === 'comment') {
    node.value = value;
    return;
  }

  for (const child of childSnapshot(node)) {
    remove(child);
  }

  if (value !== '') {
    insert(node, createTextNode(value), null);
  }
}

function createStub(kind: TypeGpuNodeKind): TypeGpuNode {
  return new HostNode(kind);
}

// Host objects must stay opaque to Svelte's deep $state proxying. References
// retained by consumers must be identical to event targets and weak-cache keys.
class HostNode implements TypeGpuNode {
  kind: TypeGpuNodeKind;
  uid = nextNodeUid++;
  revision = 0;
  treeRevision = 0;
  parent: TypeGpuNode | null = null;
  firstChild: TypeGpuNode | null = null;
  lastChild: TypeGpuNode | null = null;
  previousSibling: TypeGpuNode | null = null;
  nextSibling: TypeGpuNode | null = null;
  attributes: Record<string, unknown> = {};
  listeners: TypeGpuNodeEventRegistry = new Map();
  declare name?: string;
  declare originalName?: string;
  declare captureListeners?: TypeGpuNodeEventRegistry;
  declare runtime?: TypeGpuRuntime;
  declare value?: string;

  constructor(kind: TypeGpuNodeKind) {
    this.kind = kind;
  }

  get children(): TypeGpuNode[] {
    return childSnapshot(this);
  }
}

export function findFirst(
  node: TypeGpuNode,
  predicate: (node: TypeGpuNode) => boolean
): TypeGpuNode | null {
  if (predicate(node)) return node;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

export function walk(node: TypeGpuNode, visitor: (node: TypeGpuNode) => void): void {
  visitor(node);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    walk(child, visitor);
  }
}

function invalidateFrom(node: TypeGpuNode, dirtyMask: Dirty): void {
  const root = findRoot(node);
  invalidateRoot(root, node, dirtyMask);
}

function invalidateRoot(root: TypeGpuNode, dirtyNode: TypeGpuNode, dirtyMask: Dirty): void {
  if (dirtyMask === Dirty.None) return;

  root.runtime?.scheduleSync(root, dirtyNode, dirtyMask);
}

function dirtyForStructuralSubtree(
  node: TypeGpuNode,
  dirtyForNode: (nodeName: string | undefined) => Dirty
): Dirty {
  let dirty = dirtyForNode(node.name);
  if (dirty === Dirty.All) return dirty;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    dirty = mergeDirty(dirty, dirtyForStructuralSubtree(child, dirtyForNode));
    if (dirty === Dirty.All) return dirty;
  }

  return dirty;
}

function findRoot(node: TypeGpuNode): TypeGpuNode {
  let current = node;
  while (current.parent) current = current.parent;
  return current;
}

function markTreeChanged(node: TypeGpuNode): TypeGpuNode {
  const root = findRoot(node);
  root.treeRevision += 1;
  return root;
}

function childSnapshot(node: TypeGpuNode): TypeGpuNode[] {
  const children: TypeGpuNode[] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }

  return children;
}
