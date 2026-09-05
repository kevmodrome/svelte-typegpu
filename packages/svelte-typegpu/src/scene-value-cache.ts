import type { TypeGpuNode } from './core';
import { drawBatchKey, drawBatchKeysForItem } from './render-plan';
import type { SceneRevisionCache } from './scene-revisions';
import type { RgbaTuple, TypeGpuMaterialDescriptor, TypeGpuMeshDrawItem } from './types';

export interface SceneItemValues {
  material: TypeGpuMaterialDescriptor;
  color: RgbaTuple;
  castShadow: boolean;
}

interface ValueBinding {
  item: TypeGpuMeshDrawItem;
  read(): SceneItemValues;
}

export interface PreparedValueUpdate {
  binding: ValueBinding;
  next: SceneItemValues;
  instanceChanged: boolean;
}

// Source nodes are authoritative; these bindings are rebuilt with full scene projections.
export class SceneValueCache {
  #bindings = new Map<TypeGpuNode, ValueBinding[]>();

  reset(): void {
    this.#bindings.clear();
  }

  add(
    item: TypeGpuMeshDrawItem,
    materialNode: TypeGpuNode | null,
    read: ValueBinding['read']
  ): void {
    const binding = { item, read };
    for (const node of materialNode ? [item.node, materialNode] : [item.node]) {
      let entries = this.#bindings.get(node);
      if (!entries) this.#bindings.set(node, (entries = []));
      entries.push(binding);
    }
  }

  prepare(nodes: Iterable<TypeGpuNode>): PreparedValueUpdate[] | null {
    const affected = new Set<ValueBinding>();
    for (const node of nodes) {
      const bindings = this.#bindings.get(node);
      if (!bindings) return null;
      for (const binding of bindings) affected.add(binding);
    }
    const prepared: PreparedValueUpdate[] = [];
    for (const binding of affected) {
      const { item } = binding;
      const next = binding.read();
      // Check every batch key before mutating any item, including opacity/shadow transitions.
      if (
        drawBatchKey(drawBatchKeysForItem(item)) !==
        drawBatchKey(drawBatchKeysForItem({ ...item, ...next }))
      )
        return null;
      prepared.push({ binding, next, instanceChanged: !sameInstanceValues(item, next) });
    }
    return prepared;
  }

  apply(prepared: PreparedValueUpdate[], revisions: SceneRevisionCache) {
    const instances: TypeGpuMeshDrawItem[] = [];
    const materialItems: TypeGpuMeshDrawItem[] = [];
    const materials: TypeGpuMaterialDescriptor[] = [];
    for (const {
      binding: { item },
      next,
      instanceChanged
    } of prepared) {
      Object.assign(item, next);
      if (instanceChanged) {
        item.revision = revisions.read(item.node, `values:${item.id}`, [item.revision, next]);
        if (item.visible !== false) instances.push(item);
      }
      if (item.visible !== false && item.material.kind === 'shader') {
        materialItems.push(item);
        materials.push(item.material);
      }
    }
    return { instances, materialItems, materials };
  }
}

function sameInstanceValues(item: TypeGpuMeshDrawItem, next: SceneItemValues): boolean {
  const previous = item.material;
  const material = next.material;
  return (
    item.color.every((value, index) => value === next.color[index]) &&
    previous.roughness === material.roughness &&
    previous.metalness === material.metalness &&
    previous.opacity === material.opacity &&
    previous.specularExponent === material.specularExponent &&
    previous.transparent === material.transparent &&
    previous.depthWrite === material.depthWrite
  );
}
