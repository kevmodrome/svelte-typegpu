import { walk, type TypeGpuNode } from './core';
import type { TypeGpuInstanceDirtyRange } from './types';

export interface InstancePrimitiveDefinition {
  floatsPerInstance: number;
  matches(node: TypeGpuNode): boolean;
  pack(node: TypeGpuNode, target: Float32Array, offset: number): void;
  instanceId?(node: TypeGpuNode): number;
}

export interface PrimitiveInstanceBuffer {
  instances: Float32Array;
  instanceIds: number[];
  instanceCount: number;
  instancesChanged: boolean;
  dirtyRanges: TypeGpuInstanceDirtyRange[];
}

export interface PrimitiveInstanceCache {
  read(root: TypeGpuNode): PrimitiveInstanceBuffer;
}

export function createPrimitiveInstanceCache(
  definition: InstancePrimitiveDefinition
): PrimitiveInstanceCache {
  let treeRevision = -1;
  let nodes: TypeGpuNode[] = [];
  let nodeRevisions: number[] = [];
  let instances = new Float32Array(0);
  let instanceIds: number[] = [];

  return {
    read(root) {
      if (root.treeRevision !== treeRevision) {
        nodes = collectPrimitiveNodes(root, definition.matches);
        nodeRevisions = nodes.map((node) => node.revision);
        instances = new Float32Array(nodes.length * definition.floatsPerInstance);
        instanceIds = nodes.map((node) => definition.instanceId?.(node) ?? node.uid);

        nodes.forEach((node, index) => {
          definition.pack(node, instances, index * definition.floatsPerInstance);
        });

        treeRevision = root.treeRevision;

        return {
          instances,
          instanceIds,
          instanceCount: nodes.length,
          instancesChanged: true,
          dirtyRanges: nodes.length > 0 ? [{ start: 0, count: nodes.length }] : []
        };
      }

      const dirtyRanges: TypeGpuInstanceDirtyRange[] = [];

      nodes.forEach((node, index) => {
        if (node.revision === nodeRevisions[index]) return;

        definition.pack(node, instances, index * definition.floatsPerInstance);
        nodeRevisions[index] = node.revision;
        appendDirtyRange(dirtyRanges, index);
      });

      return {
        instances,
        instanceIds,
        instanceCount: nodes.length,
        instancesChanged: dirtyRanges.length > 0,
        dirtyRanges
      };
    }
  };
}

function collectPrimitiveNodes(
  root: TypeGpuNode,
  matches: (node: TypeGpuNode) => boolean
): TypeGpuNode[] {
  const nodes: TypeGpuNode[] = [];

  walk(root, (node) => {
    if (matches(node)) nodes.push(node);
  });

  return nodes;
}

function appendDirtyRange(ranges: TypeGpuInstanceDirtyRange[], index: number): void {
  const previous = ranges.at(-1);

  if (previous && previous.start + previous.count === index) {
    previous.count += 1;
    return;
  }

  ranges.push({ start: index, count: 1 });
}
