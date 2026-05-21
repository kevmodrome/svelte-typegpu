export const BOX_VERTEX_FLOATS = 6;
export const BOX_INSTANCE_FLOATS = 13;
export const BOX_SPIN_SPEED_OFFSET = 11;
export const BOX_SPIN_OFFSET_OFFSET = 12;
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

export function createBoxVertexData(): Float32Array {
  const data: number[] = [];

  for (const face of BOX_FACES) {
    const [a, b, c, d] = face.corners;
    for (const vertex of [a, b, c, a, c, d]) {
      data.push(...vertex, ...face.normal);
    }
  }

  return new Float32Array(data);
}
