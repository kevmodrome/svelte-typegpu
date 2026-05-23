import { numberArg } from '../attributes';
import { transformBounds } from '../bounds';
import type { TypeGpuNode } from '../core';
import type { TypeGpuLoadedModelMesh } from '../glb-loader';
import {
  DEFAULT_STANDARD_MATERIAL,
  isStandardMaterialObject,
  normalizeStandardMaterial
} from '../materials';
import type { TypeGpuModelCache } from '../model-cache';
import { composeTransforms, readLocalTransform } from '../transform';
import type {
  TypeGpuMaterialDescriptor,
  TypeGpuMeshDrawItem,
  TypeGpuTransform,
  RgbaTuple,
  Vector3Tuple
} from '../types';

export interface ModelWalkContext {
  transform: TypeGpuTransform;
  revision: number;
}

export function readModelDrawItems(
  modelNode: TypeGpuNode,
  context: ModelWalkContext,
  modelCache: TypeGpuModelCache
): TypeGpuMeshDrawItem[] {
  const entry = modelCache.read({
    src: modelNode.attributes.src,
    data: modelNode.attributes.data
  });

  if (entry.status !== 'ready') return [];

  const modelTransform = composeTransforms(context.transform, readLocalTransform(modelNode));
  const baseRevision = combineRevision(context.revision, modelNode, entry.revision);

  return entry.model.meshes.map((mesh, index) =>
    modelMeshDrawItem(modelNode, mesh, modelTransform, baseRevision, index)
  );
}

export function subtreeHasModelNode(node: TypeGpuNode | undefined): boolean {
  if (!node) return false;
  if (node.name === 'model') return true;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (subtreeHasModelNode(child)) return true;
  }

  return false;
}

function modelMeshDrawItem(
  modelNode: TypeGpuNode,
  mesh: TypeGpuLoadedModelMesh,
  modelTransform: TypeGpuTransform,
  baseRevision: number,
  index: number
): TypeGpuMeshDrawItem {
  const material = readModelMaterial(modelNode, mesh.material);
  const transform = composeTransforms(modelTransform, mesh.transform);
  const localBounds = mesh.geometry.bounds ?? defaultBounds();

  return {
    id: `model:${modelNode.uid}:primitive:${index}`,
    node: modelNode,
    revision: combineRevision(combineRevision(baseRevision, material.node), null, index),
    geometry: mesh.geometry,
    material: material.descriptor,
    transform,
    bounds: transformBounds(localBounds, transform),
    color: rgbaArg(modelNode.attributes.color, material.descriptor.color),
    phase: numberArg(modelNode.attributes.phase, 0),
    spinSpeed: numberArg(modelNode.attributes.spinSpeed, 0),
    renderOrder: numberArg(modelNode.attributes.renderOrder, 0),
    hitTest: hitTestMode(modelNode.attributes.hitTest),
    pointerEvents: modelNode.attributes.pointerEvents === 'none' ? 'none' : 'auto'
  };
}

function readModelMaterial(
  modelNode: TypeGpuNode,
  fallback: TypeGpuMaterialDescriptor
): { node: TypeGpuNode | null; descriptor: TypeGpuMaterialDescriptor } {
  for (let child = modelNode.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'standardMaterial') continue;

    const materialAttr = child.attributes.material;
    const base = isStandardMaterialObject(materialAttr)
      ? materialAttr
      : fallback.kind === 'standard'
        ? fallback
        : DEFAULT_STANDARD_MATERIAL;

    return {
      node: child,
      descriptor: normalizeStandardMaterial(base, child.attributes)
    };
  }

  return {
    node: null,
    descriptor: fallback
  };
}

function combineRevision(seed: number, node: TypeGpuNode | null, extra = 0): number {
  const nodeRevision = node ? (seed * 31 + node.uid) * 31 + node.revision : seed * 31;
  return nodeRevision * 31 + extra;
}

function rgbaArg(value: unknown, fallback: RgbaTuple): RgbaTuple {
  if (!Array.isArray(value)) return [...fallback] as RgbaTuple;

  return [
    numberArg(value[0], fallback[0]),
    numberArg(value[1], fallback[1]),
    numberArg(value[2], fallback[2]),
    numberArg(value[3], fallback[3])
  ];
}

function hitTestMode(value: unknown): 'none' | 'bounds' | 'mesh' {
  if (value === 'none' || value === 'mesh') return value;
  return 'bounds';
}

function defaultBounds() {
  return {
    min: [-0.5, -0.5, -0.5] as Vector3Tuple,
    max: [0.5, 0.5, 0.5] as Vector3Tuple
  };
}
