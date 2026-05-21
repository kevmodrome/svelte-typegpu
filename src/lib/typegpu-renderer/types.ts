export type Vector3Tuple = [number, number, number];
export type RgbaTuple = [number, number, number, number];

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

export interface TypeGpuDrawBatch {
  key: string;
  geometry: TypeGpuGeometryData;
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
  drawBatches: TypeGpuDrawBatch[];
}
