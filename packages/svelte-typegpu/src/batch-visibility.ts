import { Frustum } from './frustum';
import { growInstanceCapacity } from './instance-data';
import type { TypeGpuMeshDrawItem } from './types';

export const MAX_VISIBILITY_RANGES = 64;
const CLUSTER_SIZE = 32;
const SPATIAL_ORDER_THRESHOLD = 4096;

/** World bounds follow canonical instance slots, never the camera's selection. */
export class BatchBounds {
  readonly items: Float64Array;
  readonly nodes: Float64Array;
  readonly radii: Float64Array;
  readonly leafBase: number;
  readonly leafSize: number;
  readonly cullLeafSize: number;
  count = 0;
  revision = 0;
  lastRefitNodes = 0;

  constructor(readonly capacity: number, forLod = false) {
    this.cullLeafSize = capacity < 256 ? 1 : CLUSTER_SIZE;
    this.leafSize = forLod ? Math.min(4, this.cullLeafSize) : this.cullLeafSize;
    this.leafBase = growInstanceCapacity(Math.ceil(capacity / this.leafSize));
    this.items = new Float64Array(capacity * 6);
    this.nodes = new Float64Array(this.leafBase * 2 * 6);
    this.radii = new Float64Array(this.leafBase * 2);
  }

  rebuild(items: TypeGpuMeshDrawItem[]): void {
    this.count = items.length;
    for (let i = 0; i < items.length; i++) this.#write(i, items[i]);
    for (let i = 0; i < this.leafBase; i++) this.#refitLeaf(i);
    for (let i = this.leafBase - 1; i > 0; i--) this.#refitParent(i);
    this.revision++;
  }

  update(index: number, item: TypeGpuMeshDrawItem): void {
    this.lastRefitNodes = 0;
    if (!this.#write(index, item)) return;
    let node = this.leafBase + Math.floor(index / this.leafSize);
    this.#refitLeaf(node - this.leafBase);
    this.lastRefitNodes++;
    while ((node >>= 1) > 0) {
      this.lastRefitNodes++;
      if (!this.#refitParent(node)) break;
    }
    this.revision++;
  }

  #write(index: number, item: TypeGpuMeshDrawItem): boolean {
    const bounds = item.bounds;
    let known = !!item.geometry.bounds;
    for (let axis = 0; axis < 3; axis++) {
      if (!Number.isFinite(bounds.min[axis]) || !Number.isFinite(bounds.max[axis]) ||
        bounds.min[axis] > bounds.max[axis]) known = false;
    }
    let changed = false;
    for (let axis = 0; axis < 3; axis++) {
      const min = known ? bounds.min[axis] : -Infinity;
      const max = known ? bounds.max[axis] : Infinity;
      const i = index * 6 + axis;
      if (this.items[i] !== min || this.items[i + 3] !== max) changed = true;
      this.items[i] = min;
      this.items[i + 3] = max;
    }
    return changed;
  }

  #refitLeaf(leaf: number): void {
    const offset = (this.leafBase + leaf) * 6;
    const start = leaf * this.leafSize;
    const end = Math.min(start + this.leafSize, this.count);
    let radius = 0;
    for (let i = start; i < end; i++) {
      const offset = i * 6;
      radius = Math.max(radius, Math.hypot(this.items[offset + 3] - this.items[offset],
        this.items[offset + 4] - this.items[offset + 1], this.items[offset + 5] - this.items[offset + 2]) / 2);
    }
    this.radii[this.leafBase + leaf] = radius;
    for (let axis = 0; axis < 3; axis++) {
      let min = Infinity, max = -Infinity;
      for (let i = start; i < end; i++) {
        min = Math.min(min, this.items[i * 6 + axis]);
        max = Math.max(max, this.items[i * 6 + axis + 3]);
      }
      this.nodes[offset + axis] = min;
      this.nodes[offset + axis + 3] = max;
    }
  }

  #refitParent(node: number): boolean {
    const radius = Math.max(this.radii[node * 2], this.radii[node * 2 + 1]);
    let changed = this.radii[node] !== radius;
    this.radii[node] = radius;
    for (let axis = 0; axis < 6; axis++) {
      const left = this.nodes[node * 12 + axis], right = this.nodes[node * 12 + 6 + axis];
      const value = axis < 3 ? Math.min(left, right) : Math.max(left, right);
      if (this.nodes[node * 6 + axis] !== value) changed = true;
      this.nodes[node * 6 + axis] = value;
    }
    return changed;
  }
}

/** Reused, ordered (firstInstance, instanceCount) ranges for one render view. */
export class VisibilitySelection {
  readonly ranges = new Uint32Array(MAX_VISIBILITY_RANGES * 2);
  rangeCount = 0;
  instanceCount = 0;
  boundsTests = 0;
  fallback = false;
  #bounds?: BatchBounds;
  #boundsRevision = -1;
  #viewRevision = -1;
  #count = -1;

  select(frustum: Frustum, bounds: BatchBounds | undefined, count: number): void {
    this.boundsTests = 0;
    if (bounds === this.#bounds && this.#boundsRevision === (bounds?.revision ?? -1) &&
      this.#viewRevision === frustum.revision && this.#count === count) return;
    this.#bounds = bounds;
    this.#boundsRevision = bounds?.revision ?? -1;
    this.#viewRevision = frustum.revision;
    this.#count = count;
    this.rangeCount = this.instanceCount = 0;
    this.fallback = false;
    if (!count) return;
    if (!bounds || !frustum.valid) { this.#append(0, count); return; }
    this.#visit(frustum, bounds, 1, 0, bounds.leafBase * bounds.leafSize);
    if (this.fallback) {
      this.rangeCount = this.instanceCount = 0;
      this.#append(0, count);
    }
  }

  #visit(frustum: Frustum, bounds: BatchBounds, node: number, start: number, size: number): void {
    if (this.fallback || start >= bounds.count) return;
    this.boundsTests++;
    const classification = frustum.classify(bounds.nodes, node * 6);
    if (classification === -1) return;
    if (classification === 1 || size <= bounds.cullLeafSize) {
      this.#append(start, Math.min(size, bounds.count - start));
      return;
    }
    this.#visit(frustum, bounds, node * 2, start, size / 2);
    this.#visit(frustum, bounds, node * 2 + 1, start + size / 2, size / 2);
  }

  #append(start: number, count: number): void {
    const previous = (this.rangeCount - 1) * 2;
    if (this.rangeCount && this.ranges[previous] + this.ranges[previous + 1] === start) {
      this.ranges[previous + 1] += count;
    } else {
      if (this.rangeCount === MAX_VISIBILITY_RANGES) { this.fallback = true; return; }
      const offset = this.rangeCount++ * 2;
      this.ranges[offset] = start;
      this.ranges[offset + 1] = count;
    }
    this.instanceCount += count;
  }
}

/** Structural-only spatial ordering; animated transforms never change slot identity. */
export function spatiallyOrderInstances(items: TypeGpuMeshDrawItem[]): TypeGpuMeshDrawItem[] {
  const material = items[0]?.material;
  if (items.length < SPATIAL_ORDER_THRESHOLD || !material || material.transparent ||
    (material.blendMode ?? 'opaque') !== 'opaque' || material.depthWrite === false ||
    material.depthTest === false || material.opacity < 1 || items.some(item => item.color[3] < 1)) return items;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const item of items) for (let axis = 0; axis < 3; axis++) {
    const center = (item.bounds.min[axis] + item.bounds.max[axis]) / 2;
    if (!Number.isFinite(center)) return items;
    min[axis] = Math.min(min[axis], center);
    max[axis] = Math.max(max[axis], center);
  }
  // Preserve world-space aspect ratio; tiny vertical jitter must not separate neighbours.
  const scale = 1023 / (Math.max(...max.map((value, axis) => value - min[axis])) || 1);
  return items.map(item => {
    let key = 0;
    for (let axis = 0; axis < 3; axis++) {
      const center = (item.bounds.min[axis] + item.bounds.max[axis]) / 2;
      const coordinate = Math.max(0, Math.min(1023, Math.floor((center - min[axis]) * scale)));
      key |= spreadBits(coordinate) << axis;
    }
    return { item, key };
  }).sort((a, b) => a.key - b.key).map(entry => entry.item);
}

function spreadBits(value: number): number {
  value = (value | value << 16) & 0x030000ff;
  value = (value | value << 8) & 0x0300f00f;
  value = (value | value << 4) & 0x030c30c3;
  return (value | value << 2) & 0x09249249;
}
