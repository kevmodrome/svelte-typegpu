import type { TypeGpuNode } from './core';
import { Dirty } from './dirty';

export type Vector3Tuple = [number, number, number];
export type Vector2Tuple = [number, number];
export type Vector4Tuple = [number, number, number, number];
export type RgbaTuple = [number, number, number, number];

export const MAX_TYPEGPU_LIGHTS = 32;

export type TypeGpuProceduralGeometryKind = 'box' | 'sphere';
export type TypeGpuGeometryKind = TypeGpuProceduralGeometryKind | 'imported';
export type TypeGpuMaterialKind = 'standard';
export type TypeGpuLightKind = 'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot';
export type TypeGpuInstanceId = number | string;

export interface TypeGpuPerspectiveCameraSettings {
  projection: 'perspective';
  position: Vector3Tuple;
  target: Vector3Tuple;
  fov: number;
  zoom?: never;
  near: number;
  far: number;
}

export interface TypeGpuOrthographicCameraSettings {
  projection: 'orthographic';
  position: Vector3Tuple;
  target: Vector3Tuple;
  fov?: never;
  zoom: number;
  near: number;
  far: number;
}

export type TypeGpuNormalizedCameraSettings =
  | TypeGpuPerspectiveCameraSettings
  | TypeGpuOrthographicCameraSettings;

export type TypeGpuLegacyPerspectiveCameraSettings = Omit<
  TypeGpuPerspectiveCameraSettings,
  'projection'
> & {
  projection?: 'perspective';
};

export type TypeGpuCameraSettings =
  | TypeGpuLegacyPerspectiveCameraSettings
  | TypeGpuNormalizedCameraSettings;

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
  moveForward: string;
  moveBackward: string;
  moveLeft: string;
  moveRight: string;
  moveUp: string;
  moveDown: string;
  step: number;
  moveStep: number;
  smooth: boolean;
}

export type TypeGpuControlsMode = 'orbit' | 'fly';

export interface TypeGpuControlsController {
  kind: 'controls';
  mode: TypeGpuControlsMode;
  minDistance: number;
  maxDistance: number;
  invert: boolean;
  pointer: TypeGpuPointerControls | null;
  keyboard: TypeGpuKeyboardControls | null;
}

export interface TypeGpuOrbitCameraController {
  kind: 'orbit';
  camera: string | null;
  enabled: boolean;
  target: Vector3Tuple;
  minDistance: number;
  maxDistance: number;
  enablePan: boolean;
  enableZoom: boolean;
  enableRotate: boolean;
  rotateSpeed: number;
  zoomSpeed: number;
}

export type TypeGpuCameraController = TypeGpuControlsController | TypeGpuOrbitCameraController;

export interface TypeGpuCameraState {
  node: TypeGpuNode | null;
  settings: TypeGpuNormalizedCameraSettings;
  controllerNode: TypeGpuNode | null;
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

export interface TypeGpuProceduralGeometryDescriptor {
  kind: TypeGpuProceduralGeometryKind;
  size: Vector3Tuple;
}

export interface TypeGpuImportedGeometryDescriptor {
  kind: 'imported';
  key: string;
  size: Vector3Tuple;
  data: TypeGpuGeometryData;
}

export type TypeGpuGeometryDescriptor =
  | TypeGpuProceduralGeometryDescriptor
  | TypeGpuImportedGeometryDescriptor;

export interface TypeGpuTransform {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

export interface TypeGpuBounds {
  min: Vector3Tuple;
  max: Vector3Tuple;
}

export interface TypeGpuRay {
  origin: Vector3Tuple;
  direction: Vector3Tuple;
}

export interface TypeGpuUrlTextureSource {
  kind: 'url';
  src: string;
}

export interface TypeGpuEmbeddedTextureSource {
  kind: 'embedded';
  key: string;
  mimeType: string;
  data: Uint8Array;
}

export type TypeGpuTextureSource = TypeGpuUrlTextureSource | TypeGpuEmbeddedTextureSource;

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
  id: TypeGpuInstanceId;
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
  instanceIds: TypeGpuInstanceId[];
  instanceCount: number;
  instancesChanged: boolean;
  dirtyRanges: TypeGpuInstanceDirtyRange[];
}

export interface TypeGpuSceneState {
  dirty?: Dirty;
  camera: TypeGpuCameraSettings;
  cameraNode: TypeGpuNode | null;
  cameraControllerNode: TypeGpuNode | null;
  cameraController: TypeGpuCameraController | null;
  scale: number;
  animationSpeed: number;
  colorShift: number;
  lights: TypeGpuLight[];
  lightsChanged: boolean;
  drawBatches: TypeGpuDrawBatch[];
}
