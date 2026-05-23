import { clampCubeCount, sceneCameraForCount } from './cube-field';

export type Vector3Tuple = [number, number, number];

const MIN_CAMERA_DISTANCE = 1;
const RENDERER_CAMERA_PRECISION = 1_000_000;

export interface CameraControls {
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  fov: number;
  near: number;
  far: number;
}

export interface CameraChangeDetail {
  camera: CameraControls;
  orbit: {
    radius: number;
    yaw: number;
    pitch: number;
  };
}

export interface SceneControls {
  spinEnabled: boolean;
  spinSpeed: number;
  cubeScale: number;
  cubeCount: number;
  hue: number;
  camera: CameraControls;
}

export const DEFAULT_SCENE_CONTROLS: SceneControls = {
  spinEnabled: true,
  spinSpeed: 1,
  cubeScale: 1,
  cubeCount: 1,
  hue: 330,
  camera: cameraControlsForCount(1)
};

export function clampSceneControls(controls: SceneControls): SceneControls {
  return {
    spinEnabled: controls.spinEnabled,
    spinSpeed: clamp(controls.spinSpeed, 0, 2),
    cubeScale: clamp(controls.cubeScale, 0.45, 2.2),
    cubeCount: clampCubeCount(controls.cubeCount),
    hue: normalizeHue(controls.hue),
    camera: clampCameraControls(controls.camera)
  };
}

export function copySceneControls(target: SceneControls, source: SceneControls): void {
  const next = clampSceneControls(source);

  target.spinEnabled = next.spinEnabled;
  target.spinSpeed = next.spinSpeed;
  target.cubeScale = next.cubeScale;
  target.cubeCount = next.cubeCount;
  target.hue = next.hue;
  target.camera.position = next.camera.position;
  target.camera.lookAt = next.camera.lookAt;
  target.camera.fov = next.camera.fov;
  target.camera.near = next.camera.near;
  target.camera.far = next.camera.far;
}

export function cameraControlsForCount(count: number): CameraControls {
  const camera = sceneCameraForCount(count);

  return {
    position: [...camera.position],
    lookAt: [...camera.lookAt],
    fov: 45,
    near: 0.1,
    far: 500
  };
}

export function applyCameraChange(controls: SceneControls, detail: CameraChangeDetail): void {
  controls.camera.position = preciseVector(detail.camera.position, -1000, 1000);
  controls.camera.lookAt = preciseVector(detail.camera.lookAt, -1000, 1000);
  controls.camera.fov = preciseNumber(detail.camera.fov, 20, 100);
  const near = preciseNumber(detail.camera.near, 0.01, 10);
  controls.camera.near = near;
  controls.camera.far = preciseNumber(
    Math.max(clamp(detail.camera.far, 0.1, 1000), near + 1),
    0.1,
    1000
  );
}

export function nextHue(hue: number, step = 47): number {
  return normalizeHue(hue + step);
}

export function formatHueColor(hue: number): string {
  return `hsl(${normalizeHue(hue)}, 82%, 62%)`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeHue(hue: number): number {
  return ((Math.round(hue) % 360) + 360) % 360;
}

function clampCameraControls(camera: CameraControls): CameraControls {
  const near = round(clamp(camera.near, 0.01, 10));
  const lookAt = clampVector(camera.lookAt, -1000, 1000);

  return {
    position: ensureCameraDistance(clampVector(camera.position, -1000, 1000), lookAt),
    lookAt,
    fov: round(clamp(camera.fov, 20, 100)),
    near,
    far: round(Math.max(clamp(camera.far, 0.1, 1000), near + 1))
  };
}

function clampVector(vector: Vector3Tuple, min: number, max: number): Vector3Tuple {
  return vector.map((value) => round(clamp(value, min, max))) as Vector3Tuple;
}

function preciseVector(vector: Vector3Tuple, min: number, max: number): Vector3Tuple {
  return vector.map((value) => preciseNumber(value, min, max)) as Vector3Tuple;
}

function preciseNumber(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max) * RENDERER_CAMERA_PRECISION) / RENDERER_CAMERA_PRECISION;
}

function ensureCameraDistance(position: Vector3Tuple, lookAt: Vector3Tuple): Vector3Tuple {
  const dx = position[0] - lookAt[0];
  const dy = position[1] - lookAt[1];
  const dz = position[2] - lookAt[2];

  if (Math.hypot(dx, dy, dz) >= MIN_CAMERA_DISTANCE) {
    return position;
  }

  const fallbackZ =
    lookAt[2] + MIN_CAMERA_DISTANCE <= 1000
      ? lookAt[2] + MIN_CAMERA_DISTANCE
      : lookAt[2] - MIN_CAMERA_DISTANCE;

  return [lookAt[0], lookAt[1], round(fallbackZ)];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
