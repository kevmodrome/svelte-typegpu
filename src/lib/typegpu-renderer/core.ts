export type TypeGpuNodeKind = 'fragment' | 'element' | 'text' | 'comment';

export interface TypeGpuNode {
  kind: TypeGpuNodeKind;
  uid: number;
  name?: string;
  parent: TypeGpuNode | null;
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
  return { ...createStub('element'), name };
}

export function createTextNode(value = ''): TypeGpuNode {
  return { ...createStub('text'), value, children: [] };
}

export function createComment(value = ''): TypeGpuNode {
  return { ...createStub('comment'), value, children: [] };
}

export function setAttribute(node: TypeGpuNode, key: string, value: unknown): void {
  node.attributes[key] = value;
  invalidateFrom(node);
}

export function removeAttribute(node: TypeGpuNode, key: string): void {
  delete node.attributes[key];
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
    for (const child of [...node.children]) {
      insert(parent, child, anchor);
    }
    return;
  }

  if (node.parent) {
    remove(node);
  }

  const index = anchor ? parent.children.indexOf(anchor) : -1;
  if (anchor && index === -1) {
    throw new Error('Anchor node is not a child of the target parent');
  }

  if (anchor === null) {
    parent.children.push(node);
  } else {
    parent.children.splice(index, 0, node);
  }

  node.parent = parent;
  invalidateFrom(parent);
}

export function remove(node: TypeGpuNode): void {
  if (!node.parent) return;

  const parent = node.parent;
  const index = parent.children.indexOf(node);
  if (index !== -1) parent.children.splice(index, 1);
  node.parent = null;
  invalidateFrom(parent);
}

export function getParent(node: TypeGpuNode): TypeGpuNode | null {
  return node.parent;
}

export function getFirstChild(node: TypeGpuNode): TypeGpuNode | null {
  return node.children[0] ?? null;
}

export function getLastChild(node: TypeGpuNode): TypeGpuNode | null {
  return node.children.at(-1) ?? null;
}

export function getNextSibling(node: TypeGpuNode): TypeGpuNode | null {
  if (!node.parent) return null;
  const index = node.parent.children.indexOf(node);
  return node.parent.children[index + 1] ?? null;
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

  for (const child of [...node.children]) {
    remove(child);
  }

  if (value !== '') {
    insert(node, createTextNode(value), null);
  }
}

function createStub(kind: TypeGpuNodeKind): TypeGpuNode {
  return {
    kind,
    uid: nextNodeUid++,
    parent: null,
    children: [],
    attributes: {},
    listeners: new Map()
  };
}

export function findFirst(
  node: TypeGpuNode,
  predicate: (node: TypeGpuNode) => boolean
): TypeGpuNode | null {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}

export function walk(node: TypeGpuNode, visitor: (node: TypeGpuNode) => void): void {
  visitor(node);
  for (const child of node.children) {
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
