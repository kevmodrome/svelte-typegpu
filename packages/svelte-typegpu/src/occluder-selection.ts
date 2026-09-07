import type { TypeGpuDrawBatch } from './types';
import { isOcclusionEligible } from './occlusion';

export const MAX_OCCLUDER_DRAWS = 32;
export const MAX_OCCLUDER_TRIANGLES = 32768;
export const MAX_OCCLUDER_TESTS = 2048;
const MIN_AREA = 0.05;

interface Occluder {
  batch: TypeGpuDrawBatch;
  first: number;
  count: number;
  score: number;
}

interface Snapshot {
  bounds: TypeGpuDrawBatch['visibility'];
  revision: number;
  material: TypeGpuDrawBatch['material'];
  geometry: TypeGpuDrawBatch['geometry'];
  count: number;
}

/** Projected AABB area is only a selection heuristic, never depth geometry. */
export function projectedArea(bounds: Float64Array, offset: number, matrix: Float32Array): number {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let corner = 0; corner < 8; corner++) {
    const x = bounds[offset + ((corner & 1) ? 3 : 0)];
    const y = bounds[offset + 1 + ((corner & 2) ? 3 : 0)];
    const z = bounds[offset + 2 + ((corner & 4) ? 3 : 0)];
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    if (!(w > 0.0001) || !Number.isFinite(w)) return -1;
    const px = (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w;
    const py = (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w;
    if (!Number.isFinite(px) || !Number.isFinite(py)) return -1;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  return Math.max(0, Math.min(1, maxX) - Math.max(-1, minX)) *
    Math.max(0, Math.min(1, maxY) - Math.max(-1, minY)) / 4;
}

/** Retained, bounded search; batching must not disqualify an otherwise useful wall. */
export class OccluderSelection {
  readonly entries: Occluder[] = Array.from({ length: MAX_OCCLUDER_DRAWS }, () => ({
    batch: null as unknown as TypeGpuDrawBatch, first: 0, count: 0, score: 0
  }));
  readonly fullBatches = new Set<string>();
  count = 0;
  triangles = 0;
  tests = 0;
  instances = 0;
  #viewRevision = -1;
  #dirty = true;
  #batches: readonly TypeGpuDrawBatch[] = [];
  #snapshots: Snapshot[] = [];

  invalidate(): void { this.#dirty = true; }

  select(batches: readonly TypeGpuDrawBatch[], matrix: Float32Array, viewRevision: number): void {
    this.tests = 0;
    if (!this.#dirty && this.#batches === batches && this.#viewRevision === viewRevision && batches.every((batch, i) => {
      const saved = this.#snapshots[i];
      return saved?.bounds === batch.visibility && saved.revision === (batch.visibility?.revision ?? -1) &&
        saved.material === batch.material && saved.geometry === batch.geometry && saved.count === batch.instanceCount;
    })) return;
    this.#dirty = false;
    this.#batches = batches; this.#viewRevision = viewRevision;
    this.#snapshots.length = batches.length;
    this.count = this.triangles = this.instances = 0;
    this.fullBatches.clear();
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const saved = this.#snapshots[i] ??= {} as Snapshot;
      saved.bounds = batch.visibility; saved.revision = batch.visibility?.revision ?? -1;
      saved.material = batch.material; saved.geometry = batch.geometry; saved.count = batch.instanceCount;
      if (!batch.instanceCount || !isOcclusionEligible(batch) || batch.geometry.lod || this.tests >= MAX_OCCLUDER_TESTS) continue;
      const triangles = (batch.geometry.indexCount ?? batch.geometry.vertexCount) / 3;
      if (!(triangles > 0) || triangles > 4096) continue;
      if (batch.instanceCount <= 32 && triangles * batch.instanceCount <= 4096) {
        this.tests++;
        this.#offer(batch, 0, batch.instanceCount, projectedArea(batch.visibility!.nodes, 6, matrix));
      } else {
        this.#visit(batch, matrix, 1, 0, batch.visibility!.leafBase * batch.visibility!.leafSize);
      }
    }
    let kept = 0;
    for (let i = 0; i < this.count; i++) {
      const entry = this.entries[i];
      const triangles = (entry.batch.geometry.indexCount ?? entry.batch.geometry.vertexCount) / 3 * entry.count;
      if (this.triangles + triangles > MAX_OCCLUDER_TRIANGLES) continue;
      if (i !== kept) { const unused = this.entries[kept]; this.entries[kept] = entry; this.entries[i] = unused; }
      kept++; this.triangles += triangles; this.instances += entry.count;
      if (entry.first === 0 && entry.count === entry.batch.instanceCount) this.fullBatches.add(entry.batch.key);
    }
    this.count = kept;
  }

  #visit(batch: TypeGpuDrawBatch, matrix: Float32Array, node: number, start: number, size: number): void {
    if (start >= batch.instanceCount || this.tests >= MAX_OCCLUDER_TESTS) return;
    const bounds = batch.visibility!;
    this.tests++;
    const area = projectedArea(bounds.nodes, node * 6, matrix);
    // A node crossing the eye can contain useful children, so unknown area is not
    // a safe subtree rejection. The global search budget still bounds the work.
    if (area >= 0 && area < MIN_AREA) return;
    if (size <= bounds.leafSize) {
      for (let i = start; i < Math.min(start + size, batch.instanceCount) && this.tests < MAX_OCCLUDER_TESTS; i++) {
        this.tests++;
        this.#offer(batch, i, 1, projectedArea(bounds.items, i * 6, matrix));
      }
      return;
    }
    this.#visit(batch, matrix, node * 2, start, size / 2);
    this.#visit(batch, matrix, node * 2 + 1, start + size / 2, size / 2);
  }

  #offer(batch: TypeGpuDrawBatch, first: number, count: number, area: number): void {
    if (area < MIN_AREA) return;
    for (let i = first; i < first + count; i++) if (!(batch.instances[i * 24 + 7] >= 1)) return;
    const score = area / Math.sqrt((batch.geometry.indexCount ?? batch.geometry.vertexCount) / 3 * count);
    let position = this.count;
    while (position > 0 && this.entries[position - 1].score < score) position--;
    if (position >= MAX_OCCLUDER_DRAWS) return;
    const entry = this.entries[Math.min(this.count, MAX_OCCLUDER_DRAWS - 1)];
    for (let i = Math.min(this.count, MAX_OCCLUDER_DRAWS - 1); i > position; i--) this.entries[i] = this.entries[i - 1];
    entry.batch = batch; entry.first = first; entry.count = count; entry.score = score;
    this.entries[position] = entry;
    this.count = Math.min(MAX_OCCLUDER_DRAWS, this.count + 1);
  }
}
