import { growInstanceCapacity, MESH_INSTANCE_FLOATS, packMeshInstance } from './instance-data';
import { BatchBounds, spatiallyOrderInstances } from './batch-visibility';
import {
  compareDrawBatchKeys,
  drawBatchKey,
  drawBatchKeysForItem,
  type TypeGpuDrawBatchKeys
} from './render-plan';
import type {
  TypeGpuDrawBatch,
  TypeGpuInstanceDirtyRange,
  TypeGpuInstanceId,
  TypeGpuMeshDrawItem
} from './types';

interface DrawBatchGroup {
  key: string;
  keys: TypeGpuDrawBatchKeys;
  items: TypeGpuMeshDrawItem[];
}

interface DrawBatchState {
  instanceIds: TypeGpuInstanceId[];
  revisions: number[];
  instances: Float32Array;
  visibility?: BatchBounds;
}

export interface TypeGpuDrawBatchCache {
  read(items: TypeGpuMeshDrawItem[], culling?: boolean, spatialOrder?: boolean): TypeGpuDrawBatch[];
  updateMaterials(items: TypeGpuMeshDrawItem[]): void;
  updateInstances(items: TypeGpuMeshDrawItem[]): {
    batches: TypeGpuDrawBatch[];
    updates: TypeGpuDrawBatch[];
  };
}

export function createDrawBatchCache(): TypeGpuDrawBatchCache {
  const previousBatches = new Map<string, DrawBatchState>();
  const slots = new Map<
    TypeGpuInstanceId,
    { batch: TypeGpuDrawBatch; index: number; state: DrawBatchState }
  >();
  let currentBatches: TypeGpuDrawBatch[] = [];
  let dirtyBatches: TypeGpuDrawBatch[] = [];

  return {
    read(items, culling = true, spatialOrder = true) {
      slots.clear();
      const groups = groupDrawItems(items);
      if (culling && spatialOrder) for (const group of groups) group.items = spatiallyOrderInstances(group.items);
      const activeKeys = new Set(groups.map((group) => group.key));
      const batches = groups.map((group, index) =>
        readDrawBatch(group, previousBatches.get(group.key), index, culling)
      );

      for (const key of previousBatches.keys()) {
        if (!activeKeys.has(key)) previousBatches.delete(key);
      }

      for (const batch of batches) {
        const state = {
          instanceIds: batch.instanceIds,
          revisions: groupRevisionList(groups[batch.sortKey]),
          instances: batch.instances,
          visibility: batch.visibility
        };
        previousBatches.set(batch.key, state);
        batch.instanceIds.forEach((id, index) => slots.set(id, { batch, index, state }));
      }
      currentBatches = batches;
      dirtyBatches = batches.filter((batch) => batch.instancesChanged);
      return batches;
    },
    updateMaterials(items) {
      for (const item of items) {
        const slot = slots.get(item.id);
        if (slot) slot.batch.material = item.material;
      }
    },
    updateInstances(items) {
      for (const batch of dirtyBatches) {
        batch.instancesChanged = false;
        batch.dirtyRanges = [];
      }
      const changed = new Map<TypeGpuDrawBatch, number[]>();
      for (const item of items) {
        const slot = slots.get(item.id);
        if (!slot) throw new Error(`Missing instance slot for ${item.id}`);
        const { batch, index, state } = slot;
        if (state.revisions[index] === item.revision) continue;
        packMeshInstance(item, batch.instances, index * MESH_INSTANCE_FLOATS);
        batch.visibility?.update(index, item);
        state.revisions[index] = item.revision;
        let indices = changed.get(batch);
        if (!indices) changed.set(batch, (indices = []));
        indices.push(index);
      }
      dirtyBatches = [...changed.keys()];
      for (const [batch, indices] of changed) {
        batch.instancesChanged = true;
        indices.sort((a, b) => a - b);
        for (const index of indices) appendDirtyRange(batch.dirtyRanges, index);
      }
      return { batches: currentBatches, updates: dirtyBatches };
    }
  };
}

function groupDrawItems(items: TypeGpuMeshDrawItem[]): DrawBatchGroup[] {
  const groupedItems = new Map<string, DrawBatchGroup>();

  for (const item of items) {
    const keys = drawBatchKeysForItem(item);
    const key = drawBatchKey(keys);
    const group = groupedItems.get(key);

    if (group) {
      group.items.push(item);
    } else {
      groupedItems.set(key, { key, keys, items: [item] });
    }
  }

  return [...groupedItems.values()].sort((a, b) => compareDrawBatchKeys(a.keys, b.keys));
}

function readDrawBatch(
  group: DrawBatchGroup,
  previous: DrawBatchState | undefined,
  sortKey: number,
  culling: boolean
): TypeGpuDrawBatch {
  const items = group.items;
  const instanceIds = items.map((item) => item.id);
  const requiredFloats = items.length * MESH_INSTANCE_FLOATS;
  const reallocate = !previous || previous.instances.buffer.byteLength < requiredFloats * 4;
  const instances = reallocate
    ? new Float32Array(growInstanceCapacity(items.length) * MESH_INSTANCE_FLOATS).subarray(
        0,
        requiredFloats
      )
    : previous.instances.length === requiredFloats
      ? previous.instances
      : new Float32Array(previous.instances.buffer, 0, requiredFloats);
  const dirtyRanges: TypeGpuInstanceDirtyRange[] = [];
  const visibility = culling
    ? previous?.visibility && previous.visibility.capacity >= items.length
      ? previous.visibility
      : new BatchBounds(growInstanceCapacity(items.length))
    : undefined;
  visibility?.rebuild(items);

  items.forEach((item, index) => {
    if (
      !reallocate &&
      previous.instanceIds[index] === item.id &&
      previous.revisions[index] === item.revision
    )
      return;
    packMeshInstance(item, instances, index * MESH_INSTANCE_FLOATS);
    appendDirtyRange(dirtyRanges, index);
  });

  return {
    ...batchBase(group, sortKey),
    instances,
    instanceIds,
    instanceCount: items.length,
    instancesChanged: dirtyRanges.length > 0,
    visibility,
    dirtyRanges
  };
}

function batchBase(
  group: DrawBatchGroup,
  sortKey: number
): Omit<
  TypeGpuDrawBatch,
  'instances' | 'instanceIds' | 'instanceCount' | 'instancesChanged' | 'dirtyRanges'
> {
  const item = group.items[0];

  return {
    key: group.key,
    passKey: group.keys.passKey,
    pipelineKey: group.keys.pipelineKey,
    materialKey: group.keys.materialKey,
    bindGroupKey: group.keys.bindGroupKey,
    geometryKey: group.keys.geometryKey,
    geometry: item.geometry,
    material: item.material,
    castShadow: group.keys.castShadow,
    renderOrder: group.keys.renderOrder,
    floatsPerInstance: MESH_INSTANCE_FLOATS,
    sortKey
  };
}

function groupRevisionList(group: DrawBatchGroup | undefined): number[] {
  return group?.items.map((item) => item.revision) ?? [];
}

function appendDirtyRange(ranges: TypeGpuInstanceDirtyRange[], index: number): void {
  const previous = ranges.at(-1);

  if (previous && previous.start + previous.count === index) {
    previous.count += 1;
    return;
  }

  ranges.push({ start: index, count: 1 });
}
