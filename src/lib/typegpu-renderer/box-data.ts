import {
  MESH_INSTANCE_FLOATS,
  MESH_SPIN_OFFSET_OFFSET,
  MESH_SPIN_SPEED_OFFSET,
  MESH_VERTEX_FLOATS
} from './instance-data';
import type { TypeGpuGeometryData } from './types';

export const BOX_VERTEX_FLOATS = MESH_VERTEX_FLOATS;
export const BOX_INSTANCE_FLOATS = MESH_INSTANCE_FLOATS;
export const BOX_SPIN_SPEED_OFFSET = MESH_SPIN_SPEED_OFFSET;
export const BOX_SPIN_OFFSET_OFFSET = MESH_SPIN_OFFSET_OFFSET;
export const BOX_VERTEX_COUNT = 36;

const BOX_FACES: Array<{
  normal: [number, number, number];
  corners: Array<[number, number, number]>;
}> = [
  {
    normal: [0, 0, 1],
    corners: [
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5]
    ]
  },
  {
    normal: [0, 0, -1],
    corners: [
      [0.5, -0.5, -0.5],
      [-0.5, -0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [0.5, 0.5, -0.5]
    ]
  },
  {
    normal: [1, 0, 0],
    corners: [
      [0.5, -0.5, 0.5],
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [0.5, 0.5, 0.5]
    ]
  },
  {
    normal: [-1, 0, 0],
    corners: [
      [-0.5, -0.5, -0.5],
      [-0.5, -0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [-0.5, 0.5, -0.5]
    ]
  },
  {
    normal: [0, 1, 0],
    corners: [
      [-0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
      [0.5, 0.5, -0.5],
      [-0.5, 0.5, -0.5]
    ]
  },
  {
    normal: [0, -1, 0],
    corners: [
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, -0.5, 0.5],
      [-0.5, -0.5, 0.5]
    ]
  }
];

const FACE_UVS: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1]
];

export function createBoxVertexData(): Float32Array {
  const data: number[] = [];

  for (const face of BOX_FACES) {
    const [a, b, c, d] = face.corners;
    const [uvA, uvB, uvC, uvD] = FACE_UVS;

    for (const [vertex, uv] of [
      [a, uvA],
      [b, uvB],
      [c, uvC],
      [a, uvA],
      [c, uvC],
      [d, uvD]
    ] as const) {
      data.push(...vertex, ...face.normal, ...uv);
    }
  }

  return new Float32Array(data);
}

export function createBoxGeometryData(): TypeGpuGeometryData {
  return {
    key: 'box',
    vertexData: createBoxVertexData(),
    vertexCount: BOX_VERTEX_COUNT,
    vertexFloats: MESH_VERTEX_FLOATS
  };
}
