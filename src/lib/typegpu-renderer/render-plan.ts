import type { TypeGpuMaterialDescriptor, TypeGpuMeshDrawItem } from './types';

export const TYPEGPU_MAIN_PASS_KEY = 'pass:main';
export const TYPEGPU_DEFAULT_PIPELINE_KEY = 'pipeline:standard:opaque';
export const TYPEGPU_DEFAULT_MATERIAL_KEY = 'material:standard:white';
export const TYPEGPU_DEFAULT_BIND_GROUP_KEY = 'bind:solid';

export interface TypeGpuDrawBatchKeys {
  passKey: string;
  pipelineKey: string;
  materialKey: string;
  bindGroupKey: string;
  geometryKey: string;
  renderOrder: number;
}

export function drawBatchKeysForItem(item: TypeGpuMeshDrawItem): TypeGpuDrawBatchKeys {
  return {
    passKey: TYPEGPU_MAIN_PASS_KEY,
    pipelineKey: keyOrDefault(item.material.pipelineKey, TYPEGPU_DEFAULT_PIPELINE_KEY),
    materialKey: keyOrDefault(item.material.key, materialKeyFor(item.material)),
    bindGroupKey: keyOrDefault(item.material.bindGroupKey, TYPEGPU_DEFAULT_BIND_GROUP_KEY),
    geometryKey: item.geometry.key,
    renderOrder: item.renderOrder
  };
}

export function drawBatchKey(keys: TypeGpuDrawBatchKeys): string {
  return `${keys.passKey}|${keys.pipelineKey}|${keys.materialKey}|${keys.bindGroupKey}|${keys.geometryKey}|order:${keys.renderOrder}`;
}

export function compareDrawBatchKeys(a: TypeGpuDrawBatchKeys, b: TypeGpuDrawBatchKeys): number {
  return (
    compareString(a.passKey, b.passKey) ||
    compareNumber(a.renderOrder, b.renderOrder) ||
    compareString(a.pipelineKey, b.pipelineKey) ||
    compareString(a.materialKey, b.materialKey) ||
    compareString(a.bindGroupKey, b.bindGroupKey) ||
    compareString(a.geometryKey, b.geometryKey)
  );
}

function materialKeyFor(material: TypeGpuMaterialDescriptor): string {
  return material.kind === 'standard' ? TYPEGPU_DEFAULT_MATERIAL_KEY : `material:${material.kind}`;
}

function keyOrDefault(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

function compareString(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNumber(a: number, b: number): number {
  return a - b;
}
