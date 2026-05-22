import type { TypeGpuLight, TypeGpuLightKind } from './types';
import {
  MAX_TYPEGPU_LIGHTS,
  TYPEGPU_LIGHTING_BYTES,
  TYPEGPU_LIGHT_RECORD_BYTES
} from './typegpu-layouts';

export const TYPEGPU_LIGHT_KIND: Record<TypeGpuLightKind, number> = {
  ambient: 1,
  hemisphere: 2,
  directional: 3,
  point: 4,
  spot: 5
};

const HEADER_BYTES = 16;

export function packLightingState(lights: TypeGpuLight[]): ArrayBuffer {
  const buffer = new ArrayBuffer(TYPEGPU_LIGHTING_BYTES);
  const view = new DataView(buffer);
  const count = Math.min(MAX_TYPEGPU_LIGHTS, lights.length);

  view.setUint32(0, count, true);

  for (let index = 0; index < count; index += 1) {
    writeLight(view, HEADER_BYTES + index * TYPEGPU_LIGHT_RECORD_BYTES, lights[index]);
  }

  return buffer;
}

function writeLight(view: DataView, offset: number, light: TypeGpuLight): void {
  view.setUint32(offset, TYPEGPU_LIGHT_KIND[light.kind], true);
  view.setUint32(offset + 4, light.castsShadow ? 1 : 0, true);
  view.setUint32(offset + 8, Math.max(0, light.shadowIndex), true);
  view.setUint32(offset + 12, 0, true);

  writeVec4(view, offset + 16, light.position[0], light.position[1], light.position[2], light.range);
  writeVec4(view, offset + 32, light.direction[0], light.direction[1], light.direction[2], light.angle);
  writeVec4(view, offset + 48, light.color[0], light.color[1], light.color[2], light.intensity);
  writeVec4(
    view,
    offset + 64,
    light.groundColor[0],
    light.groundColor[1],
    light.groundColor[2],
    0
  );
  writeVec4(view, offset + 80, light.decay, light.penumbra, 0, 0);
}

function writeVec4(
  view: DataView,
  offset: number,
  x: number,
  y: number,
  z: number,
  w: number
): void {
  view.setFloat32(offset, x, true);
  view.setFloat32(offset + 4, y, true);
  view.setFloat32(offset + 8, z, true);
  view.setFloat32(offset + 12, w, true);
}
