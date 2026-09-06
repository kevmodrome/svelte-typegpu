/** Conservative AABB tests against the WebGPU clip volume: -w <= x,y <= w, 0 <= z <= w. */
export class Frustum {
  readonly planes = new Float64Array(24);
  readonly #matrix = new Float32Array(16).fill(NaN);
  revision = 0;
  valid = false;

  setMatrix(matrix: ArrayLike<number>): void {
    let changed = false;
    for (let i = 0; i < 16; i++) {
      if (matrix[i] !== this.#matrix[i]) changed = true;
    }
    if (!changed) return;
    this.revision++;
    for (let i = 0; i < 16; i++) this.#matrix[i] = matrix[i];
    this.valid = true;
    for (let plane = 0; plane < 6; plane++) {
      const axis = plane >> 1;
      const sign = plane % 2 === 0 ? 1 : -1;
      const offset = plane * 4;
      for (let column = 0; column < 4; column++) {
        const i = column * 4;
        this.planes[offset + column] = plane === 4
          ? matrix[i + 2]
          : matrix[i + 3] + sign * matrix[i + axis];
      }
      const length = Math.hypot(this.planes[offset], this.planes[offset + 1], this.planes[offset + 2]);
      if (!Number.isFinite(length) || length === 0 || !Number.isFinite(this.planes[offset + 3])) {
        this.valid = false;
      } else {
        for (let i = 0; i < 4; i++) this.planes[offset + i] /= length;
      }
    }
  }

  /** -1: outside, 0: intersecting/unknown, 1: completely inside. */
  classify(bounds: Float64Array, offset: number): -1 | 0 | 1 {
    if (!this.valid) return 0;
    for (let i = 0; i < 6; i++) if (!Number.isFinite(bounds[offset + i])) return 0;
    let inside = true;
    for (let p = 0; p < 24; p += 4) {
      let nearest = this.planes[p + 3], furthest = nearest;
      let magnitude = Math.abs(nearest) + 1;
      for (let axis = 0; axis < 3; axis++) {
        const normal = this.planes[p + axis];
        const min = bounds[offset + axis], max = bounds[offset + axis + 3];
        nearest += normal * (normal >= 0 ? min : max);
        furthest += normal * (normal >= 0 ? max : min);
        magnitude += Math.abs(normal) * Math.max(Math.abs(min), Math.abs(max));
      }
      // Bounds use JS transforms; the vertex shader and view matrix use f32.
      const tolerance = 1e-5 * magnitude;
      if (furthest < -tolerance) return -1;
      if (nearest <= tolerance) inside = false;
    }
    return inside ? 1 : 0;
  }
}
