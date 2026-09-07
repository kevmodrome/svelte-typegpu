import type { TypeGpuBounds, TypeGpuGeometryData, TypeGpuGeometryLodLevel, TypeGpuLoadedModel } from './types';

export interface TypeGpuModelLodLevel {
  maxScreenHeight: number;
  asset: TypeGpuLoadedModel;
}

/** Prepare once, then share the resulting asset across ordinary model instances. */
export function createModelLod(
  source: TypeGpuLoadedModel,
  levels: readonly TypeGpuModelLodLevel[],
  hysteresis = 0.1
): TypeGpuLoadedModel {
  validateThresholds(levels, hysteresis);
  if (!levels.length) return source;
  for (const { asset } of levels) {
    if (asset.meshes.length !== source.meshes.length) throw new Error('LOD models must have matching mesh counts');
    asset.meshes.forEach((mesh, index) => {
      const original = source.meshes[index];
      if (mesh.name !== original.name) throw new Error('LOD models must retain mesh names and order');
      for (const key of ['position', 'rotation', 'scale'] as const) {
        if (mesh.transform[key].some((value, axis) => value !== original.transform[key][axis])) {
          throw new Error('LOD models must retain mesh transforms');
        }
      }
    });
  }
  const meshes = source.meshes.map((mesh, index) => ({ ...mesh,
    geometry: createGeometryLod(mesh.geometry, levels.map(level => ({
      maxScreenHeight: level.maxScreenHeight, geometry: level.asset.meshes[index].geometry
    })), hysteresis)
  }));
  return { ...source, key: `lod:${JSON.stringify(meshes.map(mesh => mesh.geometry.key))}`, meshes };
}

/** Alternatives keep the base material/layout and share one set of instance transforms. */
export function createGeometryLod(
  source: TypeGpuGeometryData,
  levels: readonly TypeGpuGeometryLodLevel[],
  hysteresis = 0.1
): TypeGpuGeometryData {
  validateThresholds(levels, hysteresis);
  if (!levels.length) return source;
  const bounds: TypeGpuBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  let previousCount = source.indexCount ?? source.vertexCount;
  for (const geometry of [source, ...levels.map(level => level.geometry)]) {
    if (geometry.lod) throw new Error('LOD families cannot be nested');
    if (geometry.vertexFloats !== source.vertexFloats || geometry.layoutKey !== source.layoutKey ||
      (geometry.topology ?? 'triangle-list') !== (source.topology ?? 'triangle-list') ||
      !!geometry.hasVertexAlpha !== !!source.hasVertexAlpha) throw new Error('LOD geometry must retain vertex layout, topology and alpha mode');
    const count = geometry.indexCount ?? geometry.vertexCount;
    if (count > previousCount) throw new Error('LOD alternatives must not increase triangle count');
    previousCount = count;
    for (let axis = 0; axis < 3; axis++) {
      const min = geometry.bounds?.min[axis], max = geometry.bounds?.max[axis];
      if (min === undefined || max === undefined || !Number.isFinite(min) || !Number.isFinite(max) || min > max) {
        throw new Error('LOD geometry requires finite, ordered bounds');
      }
      bounds.min[axis] = Math.min(bounds.min[axis], min);
      bounds.max[axis] = Math.max(bounds.max[axis], max);
    }
  }
  const key = `lod:${JSON.stringify([source.key, hysteresis, levels.map(level => [level.maxScreenHeight, level.geometry.key])])}`;
  return { ...source, key, bounds, lod: { hysteresis,
    levels: Object.freeze(levels.map(level => Object.freeze({ ...level }))) } };
}

function validateThresholds(levels: readonly { maxScreenHeight: number }[], hysteresis: number): void {
  if (!Number.isFinite(hysteresis) || hysteresis < 0 || hysteresis >= 1) throw new RangeError('LOD hysteresis must be in [0, 1)');
  if (levels.length > 3) throw new RangeError('LOD supports at most four total geometry levels');
  let previous = Infinity;
  for (const { maxScreenHeight } of levels) {
    if (!Number.isFinite(maxScreenHeight) || maxScreenHeight <= 0 || maxScreenHeight >= previous) {
      throw new RangeError('LOD screen heights must be positive and strictly descending');
    }
    previous = maxScreenHeight;
  }
}
