import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  Camera,
  Color,
  DirectionalLight,
  Euler,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Quaternion,
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
  autoBatchCache?: Map<string, InstancedMesh>;
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
    case 'instancedMesh':
      node.three = new InstancedMesh(
        new BufferGeometry(),
        new MeshBasicMaterial(),
        Math.max(1, numberArg(args[0], 1))
      );
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

  for (const child of node.children) {
    attachToParent(node, child);
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

  if (key === 'instanceTransforms' && target instanceof InstancedMesh) {
    setInstanceTransforms(target, value);
    return;
  }

  if (
    target instanceof InstancedMesh &&
    (key === 'instanceField' || key === 'instanceSpin' || key === 'instanceScale')
  ) {
    setInstanceFieldTransforms(node);
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
  scheduleBatchRefresh(root);
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

function setInstanceTransforms(target: InstancedMesh, value: unknown): void {
  if (!Array.isArray(value)) return;

  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Euler();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const count = Math.min(target.instanceMatrix.count, value.length);

  for (let index = 0; index < count; index += 1) {
    const transform = value[index] as {
      position?: unknown;
      rotation?: unknown;
      scale?: unknown;
    };

    setVector3(position, transform.position);
    setEuler(rotation, transform.rotation);
    quaternion.setFromEuler(rotation);
    setVector3(scale, transform.scale ?? 1, true);
    matrix.compose(position, quaternion, scale);
    target.setMatrixAt(index, matrix);
  }

  target.count = count;
  target.instanceMatrix.needsUpdate = true;
}

function setInstanceFieldTransforms(node: ThreeNode): void {
  const target = node.three;
  if (!(target instanceof InstancedMesh)) return;

  const instances = node.attributes.instanceField;
  if (!Array.isArray(instances)) return;

  const spin = numberArg(node.attributes.instanceSpin, 0);
  const instanceScale = numberArg(node.attributes.instanceScale, 1);
  const matrix = new Matrix4();
  const position = new Vector3();
  const rotation = new Euler();
  const quaternion = new Quaternion();
  const scale = new Vector3(instanceScale, instanceScale, instanceScale);
  const count = Math.min(target.instanceMatrix.count, instances.length);

  for (let index = 0; index < count; index += 1) {
    const instance = instances[index] as { position?: unknown; phase?: unknown };
    const phase = numberArg(instance.phase, 0);
    setVector3(position, instance.position);
    rotation.set(spin + phase, spin * 0.8 + phase * 0.6, phase * 0.35);
    quaternion.setFromEuler(rotation);
    matrix.compose(position, quaternion, scale);
    target.setMatrixAt(index, matrix);
  }

  target.count = count;
  target.instanceMatrix.needsUpdate = true;
}

function scheduleBatchRefresh(root: ThreeNode): void {
  if (queuedBatchRoots.has(root)) return;

  queuedBatchRoots.add(root);
  queueMicrotask(() => {
    queuedBatchRoots.delete(root);
    refreshAutoBatches(root);
    root.runtime?.invalidate();
  });
}

function refreshAutoBatches(node: ThreeNode): void {
  for (const child of node.children) {
    refreshAutoBatches(child);
  }

  if (node.three instanceof Object3D) {
    refreshNodeBatches(node);
  }
}

function refreshNodeBatches(parent: ThreeNode): void {
  const host = parent.three;
  if (!(host instanceof Object3D)) return;

  const groups = new Map<string, ThreeNode[]>();
  for (const child of parent.children) {
    const signature = getBatchSignature(child);
    if (!signature) continue;

    const group = groups.get(signature) ?? [];
    group.push(child);
    groups.set(signature, group);
  }

  for (const [signature, group] of [...groups]) {
    if (group.length < 2) {
      groups.delete(signature);
    }
  }

  const cache = (parent.autoBatchCache ??= new Map());
  for (const [signature, batch] of [...cache]) {
    if (!groups.has(signature)) {
      host.remove(batch);
      cache.delete(signature);
    }
  }

  const renderedChildren: Object3D[] = [];
  const emittedBatches = new Set<string>();

  for (const child of parent.children) {
    const signature = getBatchSignature(child);
    const group = signature ? groups.get(signature) : undefined;

    if (signature && group) {
      let batch = cache.get(signature);
      if (!batch || batch.instanceMatrix.count < group.length) {
        if (batch) host.remove(batch);
        batch = createBatch(group, signature);
        cache.set(signature, batch);
      }

      updateBatch(batch, group);
      if (!emittedBatches.has(signature)) {
        host.add(batch);
        renderedChildren.push(batch);
        emittedBatches.add(signature);
      }

      if (child.three instanceof Object3D) {
        host.remove(child.three);
      }
      continue;
    }

    if (child.three instanceof Object3D) {
      host.add(child.three);
      renderedChildren.push(child.three);
    }
  }

  const unordered = host.children.filter((child) => !renderedChildren.includes(child));
  host.children.splice(0, host.children.length, ...renderedChildren, ...unordered);
}

function createBatch(group: ThreeNode[], signature: string): InstancedMesh {
  const firstMesh = group[0].three as Mesh;
  const batch = new InstancedMesh(firstMesh.geometry, firstMesh.material as Material, group.length);
  batch.userData.__svelteThreeBatchSignature = signature;
  return batch;
}

function updateBatch(batch: InstancedMesh, group: ThreeNode[]): void {
  const matrix = new Matrix4();
  const quaternion = new Quaternion();
  batch.count = group.length;
  batch.userData.__svelteThreeInstanceNodes = group;

  for (let index = 0; index < group.length; index += 1) {
    const mesh = group[index].three as Mesh;
    quaternion.setFromEuler(mesh.rotation);
    matrix.compose(mesh.position, quaternion, mesh.scale);
    batch.setMatrixAt(index, matrix);
  }

  batch.instanceMatrix.needsUpdate = true;
}

function getBatchSignature(node: ThreeNode): string | null {
  if (node.name !== 'mesh' || !(node.three instanceof Mesh)) return null;

  const geometry = node.children.find(
    (child) => child.role === 'geometry' && child.three instanceof BufferGeometry
  );
  const material = node.children.find(
    (child) => child.role === 'material' && child.three instanceof Material
  );

  if (!geometry || !material) return null;

  return JSON.stringify({
    geometry: geometry.name,
    geometryArgs: normalizeSignatureValue(geometry.attributes.args),
    material: material.name,
    materialAttributes: normalizeAttributes(material.attributes)
  });
}

function normalizeAttributes(attributes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(attributes)
      .filter(([key]) => key !== 'children')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeSignatureValue(value)])
  );
}

function normalizeSignatureValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeSignatureValue);
  if (value == null || ['boolean', 'number', 'string'].includes(typeof value)) return value;
  return String(value);
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

const queuedBatchRoots = new WeakSet<ThreeNode>();

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
