import type { TypeGpuNode } from './core';

export type Vector3Tuple = [number, number, number];
export type RgbaTuple = [number, number, number, number];

export const MAX_TYPEGPU_LIGHTS = 32;

export type TypeGpuGeometryKind = 'box' | 'sphere';
export type TypeGpuMaterialKind = 'standard';
export type TypeGpuLightKind = 'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot';

export interface TypeGpuCameraSettings {
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  fov: number;
  near: number;
  far: number;
}

export type TypeGpuPointerDragButton = 'primary' | 'middle' | 'secondary';
export type TypeGpuPointerWheelMode = 'zoom' | 'none';
export type TypeGpuTouchMode = 'orbit-pinch' | 'orbit' | 'pinch' | 'none';

export interface TypeGpuPointerControls {
  dragButton: TypeGpuPointerDragButton;
  rotateSpeed: number;
  wheel: TypeGpuPointerWheelMode;
  zoomSpeed: number;
  touch: TypeGpuTouchMode;
}

export interface TypeGpuKeyboardControls {
  rotateLeft: string;
  rotateRight: string;
  rotateUp: string;
  rotateDown: string;
  zoomIn: string;
  zoomOut: string;
  step: number;
}

export interface TypeGpuOrbitController {
  kind: 'orbit';
  minDistance: number;
  maxDistance: number;
  invert: boolean;
  pointer: TypeGpuPointerControls | null;
  keyboard: TypeGpuKeyboardControls | null;
}

export type TypeGpuCameraController = TypeGpuOrbitController;

export interface TypeGpuCameraState {
  node: TypeGpuNode | null;
  settings: TypeGpuCameraSettings;
  controller: TypeGpuCameraController | null;
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

export interface TypeGpuUrlTextureSource {
  kind: 'url';
  src: string;
}

export type TypeGpuTextureSource = TypeGpuUrlTextureSource;

export interface TypeGpuStandardMaterialDescriptor {
  kind: 'standard';
  color: RgbaTuple;
  roughness: number;
  metalness: number;
  opacity: number;
  map: TypeGpuTextureSource | null;
}

export type TypeGpuMaterialDescriptor = TypeGpuStandardMaterialDescriptor;

export interface TypeGpuMeshDrawItem {
  id: number;
  revision: number;
  geometry: TypeGpuGeometryDescriptor;
  material: TypeGpuMaterialDescriptor;
  transform: TypeGpuTransform;
  phase: number;
  spinSpeed: number;
}

export interface TypeGpuLight {
  id: number;
  revision: number;
  kind: TypeGpuLightKind;
  color: Vector3Tuple;
  intensity: number;
  position: Vector3Tuple;
  direction: Vector3Tuple;
  range: number;
  decay: number;
  angle: number;
  penumbra: number;
  groundColor: Vector3Tuple;
  castsShadow: boolean;
  shadowIndex: number;
}

export interface TypeGpuDrawBatch {
  key: string;
  geometry: TypeGpuGeometryData;
  material: TypeGpuMaterialDescriptor;
  floatsPerInstance: number;
  instances: Float32Array;
  instanceIds: number[];
  instanceCount: number;
  instancesChanged: boolean;
  dirtyRanges: TypeGpuInstanceDirtyRange[];
}

export interface TypeGpuSceneState {
  camera: TypeGpuCameraSettings;
  cameraNode: TypeGpuNode | null;
  cameraController: TypeGpuCameraController | null;
  scale: number;
  animationSpeed: number;
  colorShift: number;
  lights: TypeGpuLight[];
  lightsChanged: boolean;
  drawBatches: TypeGpuDrawBatch[];
}
