import { transformBounds } from './bounds';
import type { TypeGpuNode } from './core';
import { Dirty, hasDirty } from './dirty';
import { isSupportedLightNode } from './lights';
import { SceneRevisionCache } from './scene-revisions';
import { composeTransforms, IDENTITY_TRANSFORM, readLocalTransform } from './transform';
import type { TypeGpuInteractionTarget, TypeGpuMeshDrawItem, TypeGpuTransform } from './types';

export interface DrawItemWalkContext {
  transform: TypeGpuTransform;
  revision: number;
  visible: boolean;
}

interface TransformItem {
  item: TypeGpuMeshDrawItem;
  primitiveTransform?: TypeGpuTransform;
  target?: TypeGpuInteractionTarget;
}

export interface SceneTransformRecord extends DrawItemWalkContext {
  node: TypeGpuNode;
  parent: SceneTransformRecord | null;
  children: SceneTransformRecord[];
  items: TransformItem[];
  transformed: boolean;
  hasLights: boolean;
}

const TRANSFORM_DIRTY = Dirty.Transform | Dirty.Lights;
const DEFAULT_BOUNDS = { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] } as const;

// Rebuilt on full compilation; only transform-only updates mutate these projections.
export class SceneTransformCache {
  #nodes = new Map<TypeGpuNode, SceneTransformRecord>();
  #items = new Map<TypeGpuMeshDrawItem['id'], TransformItem>();
  #primitiveTransforms = new WeakMap<TypeGpuMeshDrawItem, TypeGpuTransform>();
  #root: TypeGpuNode | null = null;
  #treeRevision = -1;
  #ready = false;
  stats = { transformsUpdated: 0, itemsUpdated: 0 };

  reset(root: TypeGpuNode): void {
    this.#ready = false;
    this.#nodes.clear();
    this.#items.clear();
    this.#primitiveTransforms = new WeakMap();
    this.#root = root;
    this.#treeRevision = root.treeRevision;
    this.stats = { transformsUpdated: 0, itemsUpdated: 0 };
  }

  commit(): void {
    this.#ready = true;
  }

  setPrimitiveTransform(item: TypeGpuMeshDrawItem, transform: TypeGpuTransform): void {
    this.#primitiveTransforms.set(item, transform);
  }

  add(
    node: TypeGpuNode,
    parent: SceneTransformRecord | null,
    context: DrawItemWalkContext,
    items: TypeGpuMeshDrawItem[]
  ): SceneTransformRecord {
    const record: SceneTransformRecord = {
      ...context,
      node,
      parent,
      children: [],
      transformed: node.name === 'group' || node.name === 'mesh' || node.name === 'model',
      hasLights: isSupportedLightNode(node),
      items: items.map((item) => ({
        item,
        primitiveTransform: this.#primitiveTransforms.get(item)
      }))
    };
    this.#nodes.set(node, record);
    for (const item of record.items) this.#items.set(item.item.id, item);
    parent?.children.push(record);
    if (record.hasLights) {
      for (let ancestor = parent; ancestor; ancestor = ancestor.parent) ancestor.hasLights = true;
    }
    return record;
  }

  attachInteraction(targets: TypeGpuInteractionTarget[]): void {
    for (const target of targets) {
      if (target.drawItemId === undefined) continue;
      const entry = this.#items.get(target.drawItemId);
      if (entry) entry.target = target;
    }
  }

  canUpdate(
    root: TypeGpuNode,
    dirty: Dirty,
    nodes: ReadonlyMap<TypeGpuNode, Dirty> | undefined
  ): boolean {
    if (!this.isReady(root) || !nodes?.size)
      return false;
    if (!hasDirty(dirty, Dirty.Transform) || (dirty & ~TRANSFORM_DIRTY) !== 0) return false;
    for (const [node, mask] of nodes) {
      const record = this.#nodes.get(node);
      if (
        !record?.transformed ||
        record.hasLights ||
        !hasDirty(mask, Dirty.Transform) ||
        (mask & ~TRANSFORM_DIRTY) !== 0
      )
        return false;
    }
    return true;
  }

  isReady(root: TypeGpuNode): boolean {
    return this.#ready && root === this.#root && root.treeRevision === this.#treeRevision;
  }

  update(
    nodes: ReadonlyMap<TypeGpuNode, Dirty>,
    revisions: SceneRevisionCache
  ): {
    items: TypeGpuMeshDrawItem[];
    interactionChanged: boolean;
  } {
    this.stats = { transformsUpdated: 0, itemsUpdated: 0 };
    const result = { items: [] as TypeGpuMeshDrawItem[], interactionChanged: false };
    for (const node of nodes.keys()) {
      const record = this.#nodes.get(node)!;
      let covered = false;
      for (let parent = record.parent; parent; parent = parent.parent) {
        if (nodes.has(parent.node)) {
          covered = true;
          break;
        }
      }
      if (!covered) this.#updateRecord(record, revisions, result);
    }
    return result;
  }

  #updateRecord(
    record: SceneTransformRecord,
    revisions: SceneRevisionCache,
    result: { items: TypeGpuMeshDrawItem[]; interactionChanged: boolean }
  ): void {
    const parentTransform = record.parent?.transform ?? IDENTITY_TRANSFORM;
    const parentRevision = record.parent?.revision ?? 0;
    record.transform = record.transformed
      ? composeTransforms(parentTransform, readLocalTransform(record.node))
      : parentTransform;
    record.revision = record.transformed
      ? revisions.read(record.node, 'transform', [parentRevision, record.node.revision])
      : parentRevision;
    if (record.transformed) this.stats.transformsUpdated++;
    for (const entry of record.items) {
      const { item, primitiveTransform, target } = entry;
      item.transform = primitiveTransform
        ? composeTransforms(record.transform, primitiveTransform)
        : record.transform;
      item.bounds = transformBounds(
        item.geometry.bounds ?? { min: [...DEFAULT_BOUNDS.min], max: [...DEFAULT_BOUNDS.max] },
        item.transform
      );
      item.revision = revisions.read(record.node, `motion:${item.id}`, [record.revision]);
      if (item.visible !== false) result.items.push(item);
      if (target) {
        target.bounds = item.bounds;
        result.interactionChanged = true;
      }
      this.stats.itemsUpdated++;
    }
    for (const child of record.children) this.#updateRecord(child, revisions, result);
  }
}
