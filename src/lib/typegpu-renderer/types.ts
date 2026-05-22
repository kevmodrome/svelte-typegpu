export type Vector3Tuple = [number, number, number];
export type RgbaTuple = [number, number, number, number];

export type TypeGpuGeometryKind = 'box' | 'sphere';
export type TypeGpuMaterialKind = 'standard';

export interface TypeGpuCameraSettings {
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  fov: number;
  near: number;
  far: number;
}

export interface TypeGpuInstanceDirtyRange {
  start: number;
  count: number;
}

export interface TypeGpuGeometryData {
  key: string;
  vertexData: Float32Array;
  vertexCount: number;
  vertexFloats: number;
}

export interface TypeGpuTransform {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

export interface TypeGpuGeometryDescriptor {
  kind: TypeGpuGeometryKind;
  size: Vector3Tuple;
}

export interface TypeGpuMaterialDescriptor {
  kind: TypeGpuMaterialKind;
  color: RgbaTuple;
  roughness: number;
  metalness: number;
}

export interface TypeGpuMeshDrawItem {
  id: number;
  revision: number;
  geometry: TypeGpuGeometryDescriptor;
  material: TypeGpuMaterialDescriptor;
  transform: TypeGpuTransform;
  phase: number;
  spinSpeed: number;
}

export interface TypeGpuDrawBatch {
  key: string;
  geometry: TypeGpuGeometryData;
  floatsPerInstance: number;
  instances: Float32Array;
  instanceIds: number[];
  instanceCount: number;
  instancesChanged: boolean;
  dirtyRanges: TypeGpuInstanceDirtyRange[];
}

export interface TypeGpuSceneState {
  camera: TypeGpuCameraSettings;
  scale: number;
  animationSpeed: number;
  colorShift: number;
  drawBatches: TypeGpuDrawBatch[];
}
