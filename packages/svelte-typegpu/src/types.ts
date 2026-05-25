import type { d, TgpuFragmentFn } from 'typegpu';
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
  mode: TypeGpuControlsMode;
  target: Vector3Tuple;
  minDistance: number;
  maxDistance: number;
  invert: boolean;
  enablePan: boolean;
  enableZoom: boolean;
  enableRotate: boolean;
  rotateSpeed: number;
  zoomSpeed: number;
  keyboard: TypeGpuKeyboardControls | null;
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
  indexData?: Uint16Array | Uint32Array;
  vertexCount: number;
  indexCount?: number;
  indexFormat?: GPUIndexFormat;
  vertexFloats: number;
  bounds?: TypeGpuBounds;
  shape?: Vector3Tuple;
  topology?: TypeGpuPrimitiveTopology;
  layoutKey?: string;
  hasVertexAlpha?: boolean;
}

export interface TypeGpuLoadedModel {
  key: string;
  meshes: TypeGpuLoadedModelMesh[];
}

export interface TypeGpuLoadedModelMesh {
  geometry: TypeGpuGeometryData;
  material: TypeGpuMaterialDescriptor;
  transform: TypeGpuTransform;
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
  explicitBlendMode?: boolean;
  explicitDepthWrite?: boolean;
  explicitDepthTest?: boolean;
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
  geometries: Set<string>;
  materials: Set<string>;
  textures: Set<string>;
  samplers: Set<string>;
  pipelines: Set<string>;
}

export interface TypeGpuRenderSettings {
  clearColor: RgbaTuple;
  depth: boolean;
  alphaMode: GPUCanvasAlphaMode;
}

export interface TypeGpuMeshDrawItem {
  id: TypeGpuInstanceId;
  node: TypeGpuNode;
  revision: number;
  geometry: TypeGpuGeometryData;
  material: TypeGpuMaterialDescriptor;
  transform: TypeGpuTransform;
  bounds: TypeGpuBounds;
  color: RgbaTuple;
  phase: number;
  spinSpeed: number;
  renderOrder: number;
  hitTest: 'none' | 'bounds' | 'mesh';
  pointerEvents: 'auto' | 'none';
  drag?: string;
  castShadow: boolean;
  receiveShadow: boolean;
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
  shadowMapSize: number;
  shadowBias: number;
  shadowSlopeBias: number;
}

export interface TypeGpuDrawBatch {
  key: string;
  passKey: string;
  pipelineKey: string;
  materialKey: string;
  bindGroupKey: string;
  geometryKey: string;
  geometry: TypeGpuGeometryData;
  material: TypeGpuMaterialDescriptor;
  castShadow: boolean;
  renderOrder: number;
  floatsPerInstance: number;
  instances: Float32Array;
  instanceIds: TypeGpuInstanceId[];
  instanceCount: number;
  instancesChanged: boolean;
  dirtyRanges: TypeGpuInstanceDirtyRange[];
  sortKey: number;
}

export type TypeGpuShaderPassUniformBuiltIn = 'time' | 'resolution';
export interface TypeGpuShaderPassUniformMap {
  time?: 'time';
  resolution?: 'resolution';
}
export type TypeGpuShaderPassFragment = TgpuFragmentFn<{ uv: d.Vec2f }, d.Vec4f>;

export interface TypeGpuShaderPass {
  key: string;
  node: TypeGpuNode;
  revision: number;
  fragment: TypeGpuShaderPassFragment;
  uniforms: TypeGpuShaderPassUniformMap;
  active: boolean;
  renderOrder: number;
  sortKey: number;
}

export interface TypeGpuInteractionTarget {
  id?: TypeGpuInstanceId;
  drawItemId?: TypeGpuInstanceId;
  instanceId: TypeGpuInstanceId;
  node: TypeGpuNode;
  bounds: TypeGpuBounds;
  hitTest: 'none' | 'bounds' | 'mesh';
  pointerEvents?: 'auto' | 'none';
  handlers: Set<string>;
  renderOrder?: number;
  drag?: string;
}

export interface TypeGpuInteractionHit {
  target: TypeGpuInteractionTarget;
  node: TypeGpuNode;
  instanceId: TypeGpuInstanceId;
  distance: number;
  point: Vector3Tuple;
}

export interface TypeGpuInteractionPickInput {
  x: number;
  y: number;
  viewport: { width: number; height: number };
  camera: TypeGpuCameraSettings;
  type?: string;
}

export interface TypeGpuInteractionIndex {
  targets: TypeGpuInteractionTarget[];
  pick(input: TypeGpuInteractionPickInput): TypeGpuInteractionHit | null;
}

export interface TypeGpuDragEventDetail {
  mode?: string;
  instanceId: TypeGpuInstanceId;
  point: Vector3Tuple;
  pointerId: number;
  pointerType: string;
  button: number;
  buttons: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  previousX: number;
  previousY: number;
  clientX: number;
  clientY: number;
  startClientX: number;
  startClientY: number;
  previousClientX: number;
  previousClientY: number;
  deltaX: number;
  deltaY: number;
  movementX: number;
  movementY: number;
  totalDeltaX: number;
  totalDeltaY: number;
  cancelled: boolean;
}

export interface TypeGpuSceneState {
  dirty: Dirty;
  camera: TypeGpuCameraSettings;
  cameraNode: TypeGpuNode | null;
  cameraControllerNode: TypeGpuNode | null;
  cameraController: TypeGpuCameraController | null;
  renderSettings: TypeGpuRenderSettings;
  scale: number;
  animationSpeed: number;
  colorShift: number;
  lights: TypeGpuLight[];
  lightsChanged: boolean;
  drawBatches: TypeGpuDrawBatch[];
  drawBatchesChanged: boolean;
  shaderPasses: TypeGpuShaderPass[];
  shaderPassesChanged: boolean;
  interaction: TypeGpuInteractionIndex;
  interactionChanged: boolean;
  liveResourceKeys: TypeGpuLiveResourceKeys;
}
