import { clampCubeCount, sceneCameraForCount } from './cube-field';

export type Vector3Tuple = [number, number, number];

export interface CameraRotationControls {
  yaw: number;
  pitch: number;
}

export interface CameraControls {
  position: Vector3Tuple;
  rotation: CameraRotationControls;
  fov: number;
  near: number;
  far: number;
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
  target.camera.rotation = next.camera.rotation;
  target.camera.fov = next.camera.fov;
  target.camera.near = next.camera.near;
  target.camera.far = next.camera.far;
}

export function cameraControlsForCount(count: number): CameraControls {
  const camera = sceneCameraForCount(count);

  return {
    position: [...camera.position],
    rotation: rotationForLookAt(camera.position, camera.lookAt),
    fov: 45,
    near: 0.1,
    far: 500
  };
}

export function cameraLookAt(camera: CameraControls): Vector3Tuple {
  const yaw = toRadians(camera.rotation.yaw);
  const pitch = toRadians(camera.rotation.pitch);
  const horizontal = Math.cos(pitch);

  return [
    round(camera.position[0] + Math.sin(yaw) * horizontal),
    round(camera.position[1] + Math.sin(pitch)),
    round(camera.position[2] - Math.cos(yaw) * horizontal)
  ];
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

  return {
    position: clampVector(camera.position, -40, 40),
    rotation: {
      yaw: round(clamp(camera.rotation.yaw, -180, 180)),
      pitch: round(clamp(camera.rotation.pitch, -85, 85))
    },
    fov: round(clamp(camera.fov, 20, 100)),
    near,
    far: round(Math.max(clamp(camera.far, 0.1, 1000), near + 1))
  };
}

function clampVector(vector: Vector3Tuple, min: number, max: number): Vector3Tuple {
  return vector.map((value) => round(clamp(value, min, max))) as Vector3Tuple;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function rotationForLookAt(position: Vector3Tuple, lookAt: Vector3Tuple): CameraRotationControls {
  const direction: Vector3Tuple = [
    lookAt[0] - position[0],
    lookAt[1] - position[1],
    lookAt[2] - position[2]
  ];
  const horizontal = Math.hypot(direction[0], direction[2]) || 1;

  return {
    yaw: round(toDegrees(Math.atan2(direction[0], -direction[2]))),
    pitch: round(toDegrees(Math.atan2(direction[1], horizontal)))
  };
}

function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
