import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Camera,
  Color,
  DirectionalLight,
  Euler,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Scene,
  SphereGeometry,
  Vector3
} from 'three';

export type ThreeNodeKind = 'fragment' | 'element' | 'text' | 'comment';

export interface ThreeNode {
  kind: ThreeNodeKind;
  name?: string;
  parent: ThreeNode | null;
  children: ThreeNode[];
  attributes: Record<string, unknown>;
  listeners: Map<string, Set<(event: ThreeNodeEvent) => void>>;
  three: any;
  role: 'object' | 'geometry' | 'material' | 'none';
  runtime?: ThreeRuntime;
  value?: string;
}

export interface ThreeRuntime {
  sync(root: ThreeNode): void;
  invalidate(): void;
  setContinuous(active: boolean): void;
}

export interface ThreeNodeEvent {
  type: string;
  target: ThreeNode;
  currentTarget: ThreeNode;
  detail?: unknown;
  originalEvent?: Event;
}

export function createFragment(): ThreeNode {
  return createStub('fragment');
}

export function createElement(name: string): ThreeNode {
  const node = { ...createStub('element'), name };
  rebuildThreeObject(node);
  return node;
}

export function createTextNode(value = ''): ThreeNode {
  return { ...createStub('text'), value, children: [] };
}

export function createComment(value = ''): ThreeNode {
  return { ...createStub('comment'), value, children: [] };
}

export function setAttribute(node: ThreeNode, key: string, value: unknown): void {
  node.attributes[key] = value;

  if (key === 'args') {
    rebuildThreeObject(node);
    reattachToParent(node);
    return;
  }

  applyAttribute(node, key, value);
  invalidateFrom(node);
}

export function removeAttribute(node: ThreeNode, key: string): void {
  delete node.attributes[key];
}

export function getAttribute(node: ThreeNode, key: string): string | null {
  const value = node.attributes[key];
  return value == null ? null : String(value);
}

export function hasAttribute(node: ThreeNode, key: string): boolean {
  return key in node.attributes;
}

export function insert(parent: ThreeNode, node: ThreeNode, anchor: ThreeNode | null): void {
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
  attachToParent(parent, node);
  invalidateFrom(parent);
}

export function remove(node: ThreeNode): void {
  if (!node.parent) return;
  const parent = node.parent;
  const index = parent.children.indexOf(node);
  if (index !== -1) parent.children.splice(index, 1);
  detachFromParent(parent, node);
  node.parent = null;
  invalidateFrom(parent);
}

export function getParent(node: ThreeNode): ThreeNode | null {
  return node.parent;
}

export function getFirstChild(node: ThreeNode): ThreeNode | null {
  return node.children[0] ?? null;
}

export function getLastChild(node: ThreeNode): ThreeNode | null {
  return node.children.at(-1) ?? null;
}

export function getNextSibling(node: ThreeNode): ThreeNode | null {
  if (!node.parent) return null;
  const index = node.parent.children.indexOf(node);
  return node.parent.children[index + 1] ?? null;
}

export function addEventListener(
  node: ThreeNode,
  type: string,
  handler: (event: ThreeNodeEvent) => void
): void {
  const listeners = node.listeners.get(type) ?? new Set();
  listeners.add(handler);
  node.listeners.set(type, listeners);
}

export function removeEventListener(
  node: ThreeNode,
  type: string,
  handler: (event: ThreeNodeEvent) => void
): void {
  node.listeners.get(type)?.delete(handler);
}

export function dispatchNodeEvent(node: ThreeNode, type: string, init: Partial<ThreeNodeEvent> = {}) {
  for (const handler of node.listeners.get(type) ?? []) {
    handler({ type, target: node, currentTarget: node, ...init });
  }
}

export function setText(node: ThreeNode, value: string): void {
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

export function findFirstScene(root: ThreeNode): Scene | null {
  return findFirst(root, (node): node is ThreeNode & { three: Scene } => node.three instanceof Scene)
    ?.three ?? null;
}

export function findFirstCamera(root: ThreeNode): Camera | null {
  return findFirst(root, (node): node is ThreeNode & { three: Camera } => node.three instanceof Camera)
    ?.three ?? null;
}

function createStub(kind: ThreeNodeKind): ThreeNode {
  return {
    kind,
    parent: null,
    children: [],
    attributes: {},
    listeners: new Map(),
    three: null,
    role: 'none'
  };
}

function rebuildThreeObject(node: ThreeNode): void {
  const previous = node.three;
  const args = Array.isArray(node.attributes.args) ? node.attributes.args : [];
  const name = node.name ?? '';

  switch (name) {
    case 'scene':
      node.three = new Scene();
      node.role = 'object';
      break;
    case 'group':
    case 'object3D':
      node.three = new Group();
      node.role = 'object';
      break;
    case 'mesh':
      node.three = new Mesh();
      node.role = 'object';
      break;
    case 'perspectiveCamera':
      node.three = new PerspectiveCamera(
        numberArg(args[0], 75),
        numberArg(args[1], 1),
        numberArg(args[2], 0.1),
        numberArg(args[3], 1000)
      );
      node.role = 'object';
      break;
    case 'ambientLight':
      node.three = new AmbientLight(args[0] ?? 0xffffff, numberArg(args[1], 1));
      node.role = 'object';
      break;
    case 'directionalLight':
      node.three = new DirectionalLight(args[0] ?? 0xffffff, numberArg(args[1], 1));
      node.role = 'object';
      break;
    case 'pointLight':
      node.three = new PointLight(args[0] ?? 0xffffff, numberArg(args[1], 1));
      node.role = 'object';
      break;
    case 'boxGeometry':
      node.three = new BoxGeometry(
        numberArg(args[0], 1),
        numberArg(args[1], 1),
        numberArg(args[2], 1),
        numberArg(args[3], 1),
        numberArg(args[4], 1),
        numberArg(args[5], 1)
      );
      node.role = 'geometry';
      break;
    case 'sphereGeometry':
      node.three = new SphereGeometry(
        numberArg(args[0], 1),
        numberArg(args[1], 32),
        numberArg(args[2], 16)
      );
      node.role = 'geometry';
      break;
    case 'planeGeometry':
      node.three = new PlaneGeometry(
        numberArg(args[0], 1),
        numberArg(args[1], 1),
        numberArg(args[2], 1),
        numberArg(args[3], 1)
      );
      node.role = 'geometry';
      break;
    case 'meshBasicMaterial':
      node.three = new MeshBasicMaterial();
      node.role = 'material';
      break;
    case 'meshStandardMaterial':
      node.three = new MeshStandardMaterial();
      node.role = 'material';
      break;
    default:
      node.three = new Group();
      node.role = 'object';
      break;
  }

  if (node.three instanceof Object3D) {
    node.three.userData.__svelteThreeNode = node;
  }

  for (const [key, value] of Object.entries(node.attributes)) {
    if (key !== 'args') applyAttribute(node, key, value);
  }

  dispose(previous);
}

function applyAttribute(node: ThreeNode, key: string, value: unknown): void {
  const target = node.three;
  if (!target || key === 'children') return;

  if (key === 'position' && target.position instanceof Vector3) {
    setVector3(target.position, value);
    return;
  }

  if (key === 'rotation' && target.rotation instanceof Euler) {
    setEuler(target.rotation, value);
    return;
  }

  if (key === 'scale' && target.scale instanceof Vector3) {
    setVector3(target.scale, value, true);
    return;
  }

  if (key === 'lookAt' && target instanceof Object3D) {
    const [x, y, z] = vectorTuple(value);
    target.lookAt(x, y, z);
    return;
  }

  if (key === 'color' && 'color' in target && target.color instanceof Color) {
    target.color.set(value as ColorRepresentation);
    return;
  }

  if (key === 'background' && target instanceof Scene) {
    target.background = value == null ? null : new Color(value as ColorRepresentation);
    return;
  }

  if (key in target) {
    target[key] = value;
    if (target instanceof PerspectiveCamera && ['fov', 'aspect', 'near', 'far'].includes(key)) {
      target.updateProjectionMatrix();
    }
  }
}

function attachToParent(parent: ThreeNode, node: ThreeNode): void {
  if (parent.three instanceof Mesh && node.role === 'geometry' && node.three instanceof BufferGeometry) {
    parent.three.geometry = node.three;
    return;
  }

  if (parent.three instanceof Mesh && node.role === 'material' && node.three instanceof Material) {
    parent.three.material = node.three;
    return;
  }

  if (parent.three instanceof Object3D && node.three instanceof Object3D) {
    parent.three.add(node.three);
    syncThreeChildOrder(parent);
  }
}

function detachFromParent(parent: ThreeNode, node: ThreeNode): void {
  if (parent.three instanceof Mesh && node.role === 'geometry' && parent.three.geometry === node.three) {
    parent.three.geometry = new BufferGeometry();
    return;
  }

  if (parent.three instanceof Mesh && node.role === 'material' && parent.three.material === node.three) {
    parent.three.material = new MeshBasicMaterial();
    return;
  }

  if (parent.three instanceof Object3D && node.three instanceof Object3D) {
    parent.three.remove(node.three);
  }
}

function reattachToParent(node: ThreeNode): void {
  if (!node.parent) return;
  attachToParent(node.parent, node);
  invalidateFrom(node.parent);
}

function syncThreeChildOrder(parent: ThreeNode): void {
  if (!(parent.three instanceof Object3D)) return;

  const ordered = parent.children
    .map((child) => child.three)
    .filter((child): child is Object3D => child instanceof Object3D);

  const unordered = parent.three.children.filter((child) => !ordered.includes(child));
  parent.three.children.splice(0, parent.three.children.length, ...ordered, ...unordered);
}

function invalidateFrom(node: ThreeNode): void {
  const root = findRoot(node);
  root.runtime?.sync(root);
  root.runtime?.invalidate();
}

function findRoot(node: ThreeNode): ThreeNode {
  let current = node;
  while (current.parent) current = current.parent;
  return current;
}

function dispose(value: unknown): void {
  if (!value || !(value instanceof BufferGeometry || value instanceof Material)) return;
  value.dispose();
}

function setVector3(target: Vector3, value: unknown, allowScalar = false): void {
  if (allowScalar && typeof value === 'number') {
    target.set(value, value, value);
    return;
  }

  const [x, y, z] = vectorTuple(value);
  target.set(x, y, z);
}

function setEuler(target: Euler, value: unknown): void {
  const [x, y, z] = vectorTuple(value);
  target.set(x, y, z);
}

function vectorTuple(value: unknown): [number, number, number] {
  if (Array.isArray(value)) {
    return [numberArg(value[0], 0), numberArg(value[1], 0), numberArg(value[2], 0)];
  }

  if (value && typeof value === 'object') {
    const vector = value as { x?: unknown; y?: unknown; z?: unknown };
    return [numberArg(vector.x, 0), numberArg(vector.y, 0), numberArg(vector.z, 0)];
  }

  return [0, 0, 0];
}

function numberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

type ColorRepresentation = ConstructorParameters<typeof Color>[0];

function findFirst<T extends ThreeNode>(
  node: ThreeNode,
  predicate: (node: ThreeNode) => node is T
): T | null {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const found = findFirst(child, predicate);
    if (found) return found;
  }
  return null;
}
