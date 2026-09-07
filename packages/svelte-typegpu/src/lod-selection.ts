import { MAX_VISIBILITY_RANGES, type BatchBounds, type VisibilitySelection } from './batch-visibility';
import type { TypeGpuGeometryLod } from './types';

export const MAX_LOD_RANGES = 192;

/** Ordered canonical ranges; crossing a threshold never repacks instance data. */
export class LodSelection {
  readonly ranges: Uint32Array;
  readonly levels: Uint8Array;
  readonly clusterLevels: Uint8Array;
  rangeCount = 0;
  fallback = false;
  tests = 0;
  #viewRevision = -1;
  #boundsRevision = -1;
  #height = -1;
  #bounds?: BatchBounds;
  #visible?: VisibilitySelection;

  constructor(capacity: number, readonly policy: TypeGpuGeometryLod, rangeCapacity = MAX_LOD_RANGES) {
    if (!Number.isSafeInteger(rangeCapacity) || rangeCapacity < MAX_VISIBILITY_RANGES) throw new RangeError('LOD ranges must hold a full visibility fallback');
    this.ranges = new Uint32Array(rangeCapacity * 2);
    this.levels = new Uint8Array(rangeCapacity);
    this.clusterLevels = new Uint8Array(capacity);
  }

  select(matrix: Float32Array, viewRevision: number, height: number, bounds: BatchBounds, visible: VisibilitySelection): void {
    this.tests = 0;
    if (this.#viewRevision === viewRevision && this.#height === height && this.#bounds === bounds &&
      this.#boundsRevision === bounds.revision && this.#visible === visible) return;
    this.#viewRevision = viewRevision; this.#height = height;
    this.#bounds = bounds; this.#boundsRevision = bounds.revision; this.#visible = visible;
    this.rangeCount = 0; this.fallback = false;
    for (let range = 0; range < visible.rangeCount; range++) {
      const end = visible.ranges[range * 2] + visible.ranges[range * 2 + 1];
      let start = visible.ranges[range * 2];
      while (start < end) {
        const cluster = Math.floor(start / bounds.leafSize);
        const stop = Math.min(end, (cluster + 1) * bounds.leafSize);
        const pixels = projectedHeight(matrix, height, bounds, bounds.leafBase + cluster);
        const level = chooseLevel(pixels, this.clusterLevels[cluster], this.policy);
        this.clusterLevels[cluster] = level; this.tests++;
        if (!this.#append(start, stop - start, level)) {
          this.rangeCount = visible.rangeCount;
          this.ranges.set(visible.ranges.subarray(0, visible.rangeCount * 2));
          this.levels.fill(0, 0, this.rangeCount);
          this.fallback = true;
          return;
        }
        start = stop;
      }
    }
  }

  #append(start: number, count: number, level: number): boolean {
    const previous = this.rangeCount - 1;
    if (previous >= 0 && this.levels[previous] === level &&
      this.ranges[previous * 2] + this.ranges[previous * 2 + 1] === start) {
      this.ranges[previous * 2 + 1] += count;
    } else {
      if (this.rangeCount === this.levels.length) return false;
      const offset = this.rangeCount++;
      this.ranges[offset * 2] = start; this.ranges[offset * 2 + 1] = count;
      this.levels[offset] = level;
    }
    return true;
  }
}

export function chooseLevel(pixels: number, previous: number, policy: TypeGpuGeometryLod): number {
  let level = previous;
  if (!Number.isFinite(pixels)) return 0;
  while (level > 0 && pixels > policy.levels[level - 1].maxScreenHeight) level--;
  while (level < policy.levels.length && pixels <= policy.levels[level].maxScreenHeight * (1 - policy.hysteresis)) level++;
  return level;
}

/** Upper bound for any individual sphere in this cluster, including off-axis perspective. */
export function projectedHeight(matrix: Float32Array, height: number, bounds: BatchBounds, node: number): number {
  const radius = bounds.radii[node], offset = node * 6;
  if (!Number.isFinite(radius) || !(height > 0)) return Infinity;
  let minW = matrix[15], minY = matrix[13], maxY = minY;
  for (let axis = 0; axis < 3; axis++) {
    const min = bounds.nodes[offset + axis], max = bounds.nodes[offset + axis + 3];
    if (!Number.isFinite(min) || !Number.isFinite(max)) return Infinity;
    const w = matrix[axis * 4 + 3], y = matrix[axis * 4 + 1];
    minW += w * (w >= 0 ? min : max);
    minY += y * (y >= 0 ? min : max);
    maxY += y * (y >= 0 ? max : min);
  }
  if (!(minW > 1e-6)) return Infinity;
  const yScale = Math.hypot(matrix[1], matrix[5], matrix[9]);
  const wScale = Math.hypot(matrix[3], matrix[7], matrix[11]);
  const result = radius * height * (yScale + Math.max(Math.abs(minY), Math.abs(maxY)) * wScale / minW) / minW;
  return Number.isFinite(result) ? result : Infinity;
}
