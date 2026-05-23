import { describe, expect, it, vi } from 'vitest';
import { createFragment } from './core';
import { collectDrawItems } from './components/draw-items';
import { createDrawBatchCache } from './draw-batch-cache';
import { createModelCache } from './model-cache';
import type {
  TypeGpuGeometryData,
  TypeGpuMeshDrawItem,
  TypeGpuStandardMaterialDescriptor
} from './types';

vi.mock('./components/draw-items', () => ({
  collectDrawItems: vi.fn()
}));

const collectDrawItemsMock = vi.mocked(collectDrawItems);

describe('TypeGPU draw batch cache', () => {
  it('keeps imported geometries with the same material in separate batches', () => {
    const chairGeometry = importedGeometryData('model:chair:mesh:0');
    const tableGeometry = importedGeometryData('model:table:mesh:0');
    const material: TypeGpuStandardMaterialDescriptor = {
      kind: 'standard',
      color: [1, 1, 1, 1],
      roughness: 0.45,
      metalness: 0.05,
      opacity: 1,
      map: null
    };

    collectDrawItemsMock.mockReturnValue([
      importedMeshDrawItem(1, chairGeometry, material),
      importedMeshDrawItem(2, tableGeometry, material)
    ]);

    const batches = createDrawBatchCache().read(createFragment(), createModelCache());

    expect(batches.map((batch) => batch.key)).toEqual([
      'mesh:imported:model:chair:mesh:0:standard:solid:white',
      'mesh:imported:model:table:mesh:0:standard:solid:white'
    ]);
    expect(batches).toHaveLength(2);
    expect(batches[0].geometry).toBe(chairGeometry);
    expect(batches[1].geometry).toBe(tableGeometry);
    expect(batches[0].instanceCount).toBe(1);
    expect(batches[1].instanceCount).toBe(1);
  });
});

function importedGeometryData(key: string): TypeGpuGeometryData {
  return {
    key,
    vertexData: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0]),
    vertexCount: 1,
    vertexFloats: 8
  };
}

function importedMeshDrawItem(
  id: number,
  geometry: TypeGpuGeometryData,
  material: TypeGpuStandardMaterialDescriptor
): TypeGpuMeshDrawItem {
  return {
    id,
    revision: 1,
    geometry: {
      kind: 'imported',
      key: geometry.key,
      size: [1, 1, 1],
      data: geometry
    },
    material,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    },
    phase: 0,
    spinSpeed: 0
  };
}
