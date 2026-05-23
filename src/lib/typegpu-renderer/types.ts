import type { TypeGpuNode } from './core';
import { Dirty } from './dirty';

export type Vector3Tuple = [number, number, number];
export type Vector2Tuple = [number, number];
export type Vector4Tuple = [number, number, number, number];
export type RgbaTuple = [number, number, number, number];

export const MAX_TYPEGPU_LIGHTS = 32;

export type TypeGpuProceduralGeometryKind = 'box' | 'sphere';
export type TypeGpuGeometryKind = 'box' | 'plane' | 'sphere' | 'buffer' | 'imported';
export type TypeGpuMaterialKind = 'basic' | 'phong' | 'standard';
export type TypeGpuPrimitiveTopology = 'triangle-list';
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
  kind?: TypeGpuGeometryKind;
  vertexData: Float32Array;
  vertexCount: number;
  vertexFloats: number;
  bounds?: TypeGpuBounds;
  topology?: TypeGpuPrimitiveTopology;
  layoutKey?: string;
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
  key?: string;
  src: string;
  format?: GPUTextureFormat;
}

export interface TypeGpuEmbeddedTextureSource {
  kind: 'embedded';
  key: string;
  mimeType: string;
  data: Uint8Array;
  width?: number;
  height?: number;
  format?: GPUTextureFormat;
}

export interface TypeGpuDataTextureSource {
  kind: 'data';
  key: string;
  src: string;
  mimeType?: string;
  data: Uint8Array | Uint8ClampedArray | Float32Array;
  width?: number;
  height?: number;
  format?: GPUTextureFormat;
}

export type TypeGpuTextureSource =
  | TypeGpuUrlTextureSource
  | TypeGpuEmbeddedTextureSource
  | TypeGpuDataTextureSource;

export interface TypeGpuSamplerDescriptor {
  key: string;
  magFilter: GPUFilterMode;
  minFilter: GPUFilterMode;
  mipmapFilter: GPUMipmapFilterMode;
  addressModeU: GPUAddressMode;
  addressModeV: GPUAddressMode;
  addressModeW: GPUAddressMode;
}

export interface TypeGpuMaterialDescriptorBase<K extends TypeGpuMaterialKind> {
  key?: string;
  pipelineKey?: string;
  bindGroupKey?: string;
  kind: K;
  color: RgbaTuple;
  opacity: number;
  roughness: number;
  metalness: number;
  textureKey?: string;
  samplerKey?: string;
  texture?: TypeGpuTextureSource | null;
  sampler?: TypeGpuSamplerDescriptor;
  transparent?: boolean;
  depthWrite?: boolean;
  depthTest?: boolean;
  cullMode?: GPUCullMode;
  blendMode?: 'opaque' | 'alpha' | 'additive';
  map: TypeGpuTextureSource | null;
}

export type TypeGpuBasicMaterialDescriptor = TypeGpuMaterialDescriptorBase<'basic'>;
export type TypeGpuPhongMaterialDescriptor = TypeGpuMaterialDescriptorBase<'phong'>;
export type TypeGpuStandardMaterialDescriptor = TypeGpuMaterialDescriptorBase<'standard'>;
export type TypeGpuMaterialDescriptor =
  | TypeGpuBasicMaterialDescriptor
  | TypeGpuPhongMaterialDescriptor
  | TypeGpuStandardMaterialDescriptor;

export interface TypeGpuLiveResourceKeys {
  geometry: Set<string>;
  material: Set<string>;
  texture: Set<string>;
  sampler: Set<string>;
}

export interface TypeGpuMeshDrawItem {
  id: TypeGpuInstanceId;
  revision: number;
  geometry: TypeGpuGeometryDescriptor;
  material: TypeGpuStandardMaterialDescriptor;
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
  material: TypeGpuStandardMaterialDescriptor;
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
