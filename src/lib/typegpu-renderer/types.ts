export type Vector3Tuple = [number, number, number];
export type RgbaTuple = [number, number, number, number];

export interface TypeGpuCameraSettings {
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  fov: number;
  near: number;
  far: number;
}

export interface TypeGpuSceneState {
  camera: TypeGpuCameraSettings;
  instances: Float32Array;
  instanceIds: number[];
  instanceCount: number;
}
