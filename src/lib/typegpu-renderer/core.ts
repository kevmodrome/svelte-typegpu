export type TypeGpuNodeKind = 'fragment' | 'element' | 'text' | 'comment';

export interface TypeGpuNode {
  kind: TypeGpuNodeKind;
  uid: number;
  revision: number;
  treeRevision: number;
  name?: string;
  parent: TypeGpuNode | null;
  firstChild: TypeGpuNode | null;
  lastChild: TypeGpuNode | null;
  previousSibling: TypeGpuNode | null;
  nextSibling: TypeGpuNode | null;
  children: TypeGpuNode[];
  attributes: Record<string, unknown>;
  listeners: Map<string, Set<(event: TypeGpuNodeEvent) => void>>;
  runtime?: TypeGpuRuntime;
  value?: string;
}

let nextNodeUid = 1;

export interface TypeGpuRuntime {
  scheduleSync(root: TypeGpuNode): void;
}

export interface TypeGpuNodeEvent {
  type: string;
  target: TypeGpuNode;
  currentTarget: TypeGpuNode;
  detail?: unknown;
  originalEvent?: Event;
}

export function createFragment(): TypeGpuNode {
  return createStub('fragment');
}

export function createElement(name: string): TypeGpuNode {
  const node = createStub('element');
  node.name = name;
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
  node.attributes[key] = value;
  node.revision += 1;
  invalidateFrom(node);
}

export function removeAttribute(node: TypeGpuNode, key: string): void {
  delete node.attributes[key];
  node.revision += 1;
  invalidateFrom(node);
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

  markTreeChanged(parent);
  invalidateFrom(parent);
}

export function remove(node: TypeGpuNode): void {
  if (!node.parent) return;

  const parent = node.parent;
  const previous = node.previousSibling;
  const next = node.nextSibling;

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

  node.parent = null;
  node.previousSibling = null;
  node.nextSibling = null;
  markTreeChanged(parent);
  invalidateFrom(parent);
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
  node: TypeGpuNode,
  type: string,
  handler: (event: TypeGpuNodeEvent) => void
): void {
  const listeners = node.listeners.get(type) ?? new Set();
  listeners.add(handler);
  node.listeners.set(type, listeners);
}

export function removeEventListener(
  node: TypeGpuNode,
  type: string,
  handler: (event: TypeGpuNodeEvent) => void
): void {
  node.listeners.get(type)?.delete(handler);
}

export function dispatchNodeEvent(
  node: TypeGpuNode,
  type: string,
  init: Partial<TypeGpuNodeEvent> = {}
): void {
  for (const handler of node.listeners.get(type) ?? []) {
    handler({ type, target: node, currentTarget: node, ...init });
  }
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
  const node = {
    kind,
    uid: nextNodeUid++,
    revision: 0,
    treeRevision: 0,
    parent: null,
    firstChild: null,
    lastChild: null,
    previousSibling: null,
    nextSibling: null,
    attributes: {},
    listeners: new Map()
  } as TypeGpuNode;

  Object.defineProperty(node, 'children', {
    enumerable: true,
    get() {
      return childSnapshot(node);
    }
  });

  return node;
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

function invalidateFrom(node: TypeGpuNode): void {
  const root = findRoot(node);
  root.runtime?.scheduleSync(root);
}

function findRoot(node: TypeGpuNode): TypeGpuNode {
  let current = node;
  while (current.parent) current = current.parent;
  return current;
}

function markTreeChanged(node: TypeGpuNode): void {
  findRoot(node).treeRevision += 1;
}

function childSnapshot(node: TypeGpuNode): TypeGpuNode[] {
  const children: TypeGpuNode[] = [];

  for (let child = node.firstChild; child; child = child.nextSibling) {
    children.push(child);
  }

  return children;
}
