type Vec2 = [number, number];
type Vec3 = [number, number, number];
type Rgba = [number, number, number, number];
type Bounds = { min: Vec3; max: Vec3 };

const cubeFaces: { normal: Vec3; vertices: Vec3[]; uvs: Vec2[] }[] = [
  {
    normal: [0, 0, 1],
    vertices: [
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1]
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
      [1, 1],
      [0, 1]
    ]
  },
  {
    normal: [0, 0, -1],
    vertices: [
      [-1, -1, -1],
      [-1, 1, -1],
      [1, -1, -1],
      [1, -1, -1],
      [-1, 1, -1],
      [1, 1, -1]
    ],
    uvs: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ]
  },
  {
    normal: [0, 1, 0],
    vertices: [
      [-1, 1, -1],
      [-1, 1, 1],
      [1, 1, -1],
      [1, 1, -1],
      [-1, 1, 1],
      [1, 1, 1]
    ],
    uvs: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ]
  },
  {
    normal: [0, -1, 0],
    vertices: [
      [-1, -1, -1],
      [1, -1, -1],
      [-1, -1, 1],
      [1, -1, -1],
      [1, -1, 1],
      [-1, -1, 1]
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0, 1]
    ]
  },
  {
    normal: [1, 0, 0],
    vertices: [
      [1, -1, -1],
      [1, 1, -1],
      [1, -1, 1],
      [1, -1, 1],
      [1, 1, -1],
      [1, 1, 1]
    ],
    uvs: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 0],
      [0, 1],
      [1, 1]
    ]
  },
  {
    normal: [-1, 0, 0],
    vertices: [
      [-1, -1, -1],
      [-1, -1, 1],
      [-1, 1, -1],
      [-1, -1, 1],
      [-1, 1, 1],
      [-1, 1, -1]
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [0, 1]
    ]
  }
];

const floorFace = {
  normal: [0, 1, 0] as Vec3,
  vertices: [
    [-1, 0, 1],
    [1, 0, 1],
    [1, 0, -1],
    [-1, 0, 1],
    [1, 0, -1],
    [-1, 0, -1]
  ] as Vec3[],
  uvs: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
    [1, 1],
    [0, 1]
  ] as Vec2[]
};

export const boxBounds: Bounds = {
  min: [-1, -1, -1],
  max: [1, 1, 1]
};

export const floorBounds: Bounds = {
  min: [-1, 0, -1],
  max: [1, 0, 1]
};

const randomColors = createStableColorSequence(cubeFaces.length * 6 * 2 + floorFace.vertices.length);

export const leftBoxVertices = createCubeVertices(randomColors, 0);
export const rightBoxVertices = createCubeVertices(randomColors, cubeFaces.length * 6);
export const floorVertices = createFloorVertices(randomColors, cubeFaces.length * 6 * 2);

function createCubeVertices(colors: Rgba[], colorOffset: number): Float32Array {
  const values: number[] = [];

  cubeFaces.forEach((face, faceIndex) => {
    face.vertices.forEach((position, vertexIndex) => {
      const color = colors[colorOffset + faceIndex * face.vertices.length + vertexIndex] ?? [1, 1, 1, 1];
      pushVertex(values, position, face.normal, face.uvs[vertexIndex] ?? [0, 0], color);
    });
  });

  return new Float32Array(values);
}

function createFloorVertices(colors: Rgba[], colorOffset: number): Float32Array {
  const values: number[] = [];

  floorFace.vertices.forEach((position, vertexIndex) => {
    const color = colors[colorOffset + vertexIndex] ?? [1, 1, 1, 1];
    pushVertex(values, position, floorFace.normal, floorFace.uvs[vertexIndex] ?? [0, 0], color);
  });

  return new Float32Array(values);
}

function pushVertex(values: number[], position: Vec3, normal: Vec3, uv: Vec2, color: Rgba): void {
  values.push(...position, ...normal, ...uv, ...color);
}

function createStableColorSequence(vertexCount: number): Rgba[] {
  const random = stableRandom();
  const colors: Rgba[] = [];

  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex += 1) {
    colors.push([random(), random(), random(), 1]);
  }

  return colors;
}

function stableRandom(): () => number {
  let state = 0x6d2b79f5;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
