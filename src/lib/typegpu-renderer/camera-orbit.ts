import type { TypeGpuCameraSettings, Vector3Tuple } from './types';

const DEFAULT_MIN_DISTANCE = 1;
const DEFAULT_MAX_DISTANCE = 100;
const ORBIT_SENSITIVITY = 0.005;
const ZOOM_SENSITIVITY = 0.05;
const MIN_PITCH = -Math.PI / 2 + 0.01;
const MAX_PITCH = Math.PI / 2 - 0.01;
const MAX_WHEEL_DELTA = 60;
const ZERO_RADIUS_EPSILON = 1e-6;
const WHEEL_DELTA_MODE_PIXEL = 0;
const WHEEL_DELTA_MODE_LINE = 1;
const WHEEL_DELTA_MODE_PAGE = 2;

export interface TypeGpuOrbitConstraints {
  minDistance: number;
  maxDistance: number;
}

export interface TypeGpuOrbitState {
  target: Vector3Tuple;
  radius: number;
  yaw: number;
  pitch: number;
}

export interface TypeGpuOrbitRotateOptions extends TypeGpuOrbitConstraints {
  invert: boolean;
  rotateSpeed: number;
}

export interface TypeGpuOrbitZoomOptions extends TypeGpuOrbitConstraints {
  zoomSpeed: number;
}

export function deriveOrbitState(
  camera: TypeGpuCameraSettings,
  constraints: TypeGpuOrbitConstraints
): TypeGpuOrbitState {
  const validConstraints = normalizeConstraints(constraints);
  const dx = camera.position[0] - camera.target[0];
  const dy = camera.position[1] - camera.target[1];
  const dz = camera.position[2] - camera.target[2];
  const rawRadius = Math.hypot(dx, dy, dz);

  if (!Number.isFinite(rawRadius) || rawRadius <= ZERO_RADIUS_EPSILON) {
    return {
      target: [...camera.target],
      radius: validConstraints.minDistance,
      yaw: 0,
      pitch: 0
    };
  }

  return {
    target: [...camera.target],
    radius: clamp(rawRadius, validConstraints.minDistance, validConstraints.maxDistance),
    yaw: Math.atan2(dx, dz),
    pitch: clamp(Math.asin(dy / rawRadius), MIN_PITCH, MAX_PITCH)
  };
}

export function cameraFromOrbit(
  orbit: TypeGpuOrbitState,
  baseCamera: TypeGpuCameraSettings
): TypeGpuCameraSettings {
  const cosPitch = Math.cos(orbit.pitch);
  const position: Vector3Tuple = [
    roundToSix(orbit.target[0] + orbit.radius * Math.sin(orbit.yaw) * cosPitch),
    roundToSix(orbit.target[1] + orbit.radius * Math.sin(orbit.pitch)),
    roundToSix(orbit.target[2] + orbit.radius * Math.cos(orbit.yaw) * cosPitch)
  ];

  return {
    ...baseCamera,
    position,
    target: [...orbit.target]
  };
}

export function rotateOrbit(
  orbit: TypeGpuOrbitState,
  dx: number,
  dy: number,
  options: TypeGpuOrbitRotateOptions
): TypeGpuOrbitState {
  const constraints = normalizeConstraints(options);
  const direction = options.invert ? -1 : 1;
  const rotateSpeed = finiteOrZero(options.rotateSpeed);

  return {
    ...orbit,
    radius: clamp(orbit.radius, constraints.minDistance, constraints.maxDistance),
    yaw: orbit.yaw - dx * ORBIT_SENSITIVITY * rotateSpeed * direction,
    pitch: clamp(
      orbit.pitch + dy * ORBIT_SENSITIVITY * rotateSpeed * direction,
      MIN_PITCH,
      MAX_PITCH
    )
  };
}

export function zoomOrbit(
  orbit: TypeGpuOrbitState,
  delta: number,
  options: TypeGpuOrbitZoomOptions
): TypeGpuOrbitState {
  const constraints = normalizeConstraints(options);
  const zoomSpeed = finiteOrZero(options.zoomSpeed);

  return {
    ...orbit,
    radius: clamp(
      orbit.radius + delta * ZOOM_SENSITIVITY * zoomSpeed,
      constraints.minDistance,
      constraints.maxDistance
    )
  };
}

export function normalizeWheelDelta(deltaY: number, deltaMode: number, pageHeight: number): number {
  let multiplier: number;

  switch (deltaMode) {
    case WHEEL_DELTA_MODE_LINE:
      multiplier = 16;
      break;
    case WHEEL_DELTA_MODE_PAGE:
      multiplier = pageHeight;
      break;
    case WHEEL_DELTA_MODE_PIXEL:
    default:
      multiplier = 1;
      break;
  }

  const delta = deltaY * multiplier;

  return clamp(delta, -MAX_WHEEL_DELTA, MAX_WHEEL_DELTA);
}

function normalizeConstraints(constraints: TypeGpuOrbitConstraints): TypeGpuOrbitConstraints {
  if (
    Number.isFinite(constraints.minDistance) &&
    Number.isFinite(constraints.maxDistance) &&
    constraints.minDistance > 0 &&
    constraints.maxDistance >= constraints.minDistance
  ) {
    return constraints;
  }

  return { minDistance: DEFAULT_MIN_DISTANCE, maxDistance: DEFAULT_MAX_DISTANCE };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function roundToSix(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
