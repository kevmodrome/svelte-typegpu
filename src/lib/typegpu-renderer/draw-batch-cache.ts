import { createBoxGeometryData } from './box-data';
import { collectMeshDrawItems } from './components/mesh';
import { MESH_INSTANCE_FLOATS, packMeshInstance } from './instance-data';
import { textureKeyForMaterial } from './materials';
import { createSphereGeometryData } from './sphere-data';
import type {
  TypeGpuDrawBatch,
  TypeGpuGeometryData,
  TypeGpuGeometryKind,
  TypeGpuProceduralGeometryKind,
  TypeGpuInstanceDirtyRange,
  TypeGpuMaterialKind,
  TypeGpuMeshDrawItem
} from './types';
import type { TypeGpuNode } from './core';

type DrawBatchKey = `mesh:${TypeGpuGeometryKind}:${TypeGpuMaterialKind}:${string}`;

interface DrawBatchState {
  itemIds: number[];
  itemRevisions: number[];
  instances: Float32Array;
}

export interface TypeGpuDrawBatchCache {
  read(root: TypeGpuNode): TypeGpuDrawBatch[];
}

export function createDrawBatchCache(): TypeGpuDrawBatchCache {
  const geometries: Record<TypeGpuProceduralGeometryKind, TypeGpuGeometryData> = {
    box: createBoxGeometryData(),
    sphere: createSphereGeometryData()
  };
  const previousBatches = new Map<DrawBatchKey, DrawBatchState>();

  return {
    read(root) {
      const groupedItems = groupMeshDrawItems(collectMeshDrawItems(root));
      const batches: TypeGpuDrawBatch[] = [];

      for (const [key, items] of groupedItems) {
        const geometryKind = items[0].geometry.kind;
        const material = items[0].material;
        const batch = readDrawBatch(
          key,
          geometryKind === 'imported' ? items[0].geometry.data : geometries[geometryKind],
          material,
          items,
          previousBatches.get(key)
        );
        previousBatches.set(key, {
          itemIds: batch.instanceIds,
          itemRevisions: items.map((item) => item.revision),
          instances: batch.instances
        });
        batches.push(batch);
      }

      for (const key of previousBatches.keys()) {
        if (!groupedItems.has(key)) previousBatches.delete(key);
      }

      return batches;
    }
  };
}

function groupMeshDrawItems(items: TypeGpuMeshDrawItem[]): Map<DrawBatchKey, TypeGpuMeshDrawItem[]> {
  const groupedItems = new Map<DrawBatchKey, TypeGpuMeshDrawItem[]>();

  for (const item of items) {
    const key: DrawBatchKey = `mesh:${item.geometry.kind}:${item.material.kind}:${textureKeyForMaterial(item.material)}`;
    const group = groupedItems.get(key);

    if (group) {
      group.push(item);
    } else {
      groupedItems.set(key, [item]);
    }
  }

  return groupedItems;
}

function readDrawBatch(
  key: DrawBatchKey,
  geometry: TypeGpuGeometryData,
  material: TypeGpuMeshDrawItem['material'],
  items: TypeGpuMeshDrawItem[],
  previous: DrawBatchState | undefined
): TypeGpuDrawBatch {
  const itemIds = items.map((item) => item.id);

  if (!previous || !sameItemIds(itemIds, previous.itemIds)) {
    const instances = new Float32Array(items.length * MESH_INSTANCE_FLOATS);

    items.forEach((item, index) => {
      packMeshInstance(item, instances, index * MESH_INSTANCE_FLOATS);
    });

    return {
      key,
      geometry,
      material,
      floatsPerInstance: MESH_INSTANCE_FLOATS,
      instances,
      instanceIds: itemIds,
      instanceCount: items.length,
      instancesChanged: true,
      dirtyRanges: items.length > 0 ? [{ start: 0, count: items.length }] : []
    };
  }

  const dirtyRanges: TypeGpuInstanceDirtyRange[] = [];

  items.forEach((item, index) => {
    if (item.revision === previous.itemRevisions[index]) return;

    packMeshInstance(item, previous.instances, index * MESH_INSTANCE_FLOATS);
    appendDirtyRange(dirtyRanges, index);
  });

  return {
    key,
    geometry,
    material,
    floatsPerInstance: MESH_INSTANCE_FLOATS,
    instances: previous.instances,
    instanceIds: previous.itemIds,
    instanceCount: items.length,
    instancesChanged: dirtyRanges.length > 0,
    dirtyRanges
  };
}

function sameItemIds(next: number[], previous: number[]): boolean {
  if (next.length !== previous.length) return false;

  return next.every((id, index) => id === previous[index]);
}

function appendDirtyRange(ranges: TypeGpuInstanceDirtyRange[], index: number): void {
  const previous = ranges.at(-1);

  if (previous && previous.start + previous.count === index) {
    previous.count += 1;
    return;
  }

  ranges.push({ start: index, count: 1 });
}
