import type { TypeGpuDragEventDetail, Vector4Tuple } from 'svelte-typegpu';

const BOX_DRAG_ROTATION_SENSITIVITY = 0.003;
const SECONDARY_BUTTON_MASK = 2;

export function rotateBoxesFromDrag(
  rotation: Vector4Tuple,
  event: { detail: Pick<TypeGpuDragEventDetail, 'button' | 'buttons' | 'deltaX' | 'deltaY'> }
): Vector4Tuple {
  if ((event.detail.buttons & SECONDARY_BUTTON_MASK) === 0 && event.detail.button !== 2) {
    return rotation;
  }

  const yaw = -event.detail.deltaX * BOX_DRAG_ROTATION_SENSITIVITY;
  const pitch = -event.detail.deltaY * BOX_DRAG_ROTATION_SENSITIVITY;

  return normalizeQuaternion(multiplyQuaternions(yawPitchQuaternion(yaw, pitch), rotation));
}

function yawPitchQuaternion(yaw: number, pitch: number): Vector4Tuple {
  const halfYaw = yaw / 2;
  const halfPitch = pitch / 2;
  const sinYaw = Math.sin(halfYaw);
  const cosYaw = Math.cos(halfYaw);
  const sinPitch = Math.sin(halfPitch);
  const cosPitch = Math.cos(halfPitch);

  return [
    cosYaw * sinPitch,
    sinYaw * cosPitch,
    -sinYaw * sinPitch,
    cosYaw * cosPitch
  ];
}

function multiplyQuaternions(left: Vector4Tuple, right: Vector4Tuple): Vector4Tuple {
  const [lx, ly, lz, lw] = left;
  const [rx, ry, rz, rw] = right;

  return [
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
    lw * rw - lx * rx - ly * ry - lz * rz
  ];
}

function normalizeQuaternion(rotation: Vector4Tuple): Vector4Tuple {
  const length = Math.hypot(...rotation);

  if (!Number.isFinite(length) || length <= 1e-12) {
    return [0, 0, 0, 1];
  }

  return [rotation[0] / length, rotation[1] / length, rotation[2] / length, rotation[3] / length];
}
