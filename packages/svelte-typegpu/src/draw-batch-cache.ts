import { MESH_INSTANCE_FLOATS, packMeshInstance } from './instance-data';
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
}

export interface TypeGpuDrawBatchCache {
  read(items: TypeGpuMeshDrawItem[]): TypeGpuDrawBatch[];
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
    read(items) {
      slots.clear();
      const groups = groupDrawItems(items);
      const activeKeys = new Set(groups.map((group) => group.key));
      const batches = groups.map((group, index) =>
        readDrawBatch(group, previousBatches.get(group.key), index)
      );

      for (const key of previousBatches.keys()) {
        if (!activeKeys.has(key)) previousBatches.delete(key);
      }

      for (const batch of batches) {
        const state = {
          instanceIds: batch.instanceIds,
          revisions: groupRevisionList(groups[batch.sortKey]),
          instances: batch.instances
        };
        previousBatches.set(batch.key, state);
        batch.instanceIds.forEach((id, index) => slots.set(id, { batch, index, state }));
      }
      currentBatches = batches;
      dirtyBatches = batches.filter((batch) => batch.instancesChanged);
      return batches;
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
  sortKey: number
): TypeGpuDrawBatch {
  const items = group.items;
  const instanceIds = items.map((item) => item.id);
  const revisions = items.map((item) => item.revision);
  const instancesMatch =
    previous &&
    sameList(instanceIds, previous.instanceIds) &&
    sameList(revisions, previous.revisions);

  if (instancesMatch) {
    return {
      ...batchBase(group, sortKey),
      instances: previous.instances,
      instanceIds: previous.instanceIds,
      instanceCount: items.length,
      instancesChanged: false,
      dirtyRanges: []
    };
  }

  if (!previous || !sameList(instanceIds, previous.instanceIds)) {
    const instances = new Float32Array(items.length * MESH_INSTANCE_FLOATS);
    items.forEach((item, index) => packMeshInstance(item, instances, index * MESH_INSTANCE_FLOATS));

    return {
      ...batchBase(group, sortKey),
      instances,
      instanceIds,
      instanceCount: items.length,
      instancesChanged: true,
      dirtyRanges: items.length > 0 ? [{ start: 0, count: items.length }] : []
    };
  }

  const dirtyRanges: TypeGpuInstanceDirtyRange[] = [];

  items.forEach((item, index) => {
    if (item.revision === previous.revisions[index]) return;
    packMeshInstance(item, previous.instances, index * MESH_INSTANCE_FLOATS);
    appendDirtyRange(dirtyRanges, index);
  });

  return {
    ...batchBase(group, sortKey),
    instances: previous.instances,
    instanceIds: previous.instanceIds,
    instanceCount: items.length,
    instancesChanged: dirtyRanges.length > 0,
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

function sameList<T>(next: T[], previous: T[]): boolean {
  if (next.length !== previous.length) return false;
  return next.every((value, index) => value === previous[index]);
}

function appendDirtyRange(ranges: TypeGpuInstanceDirtyRange[], index: number): void {
  const previous = ranges.at(-1);

  if (previous && previous.start + previous.count === index) {
    previous.count += 1;
    return;
  }

  ranges.push({ start: index, count: 1 });
}
