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

export const leftBoxVertices = createCubeVertices(0);
export const rightBoxVertices = createCubeVertices(13);
export const floorVertices = createFloorVertices();

function createCubeVertices(seed: number): Float32Array {
  const values: number[] = [];

  cubeFaces.forEach((face, faceIndex) => {
    const color = faceColor(seed + faceIndex * 5);

    face.vertices.forEach((position, vertexIndex) => {
      pushVertex(values, position, face.normal, face.uvs[vertexIndex] ?? [0, 0], color);
    });
  });

  return new Float32Array(values);
}

function createFloorVertices(): Float32Array {
  const values: number[] = [];
  const color: Rgba = [0.18, 0.2, 0.22, 1];

  floorFace.vertices.forEach((position, vertexIndex) => {
    pushVertex(values, position, floorFace.normal, floorFace.uvs[vertexIndex] ?? [0, 0], color);
  });

  return new Float32Array(values);
}

function pushVertex(values: number[], position: Vec3, normal: Vec3, uv: Vec2, color: Rgba): void {
  values.push(...position, ...normal, ...uv, ...color);
}

function faceColor(seed: number): Rgba {
  return [
    0.2 + randomChannel(seed, 0) * 0.75,
    0.2 + randomChannel(seed, 1) * 0.75,
    0.2 + randomChannel(seed, 2) * 0.75,
    1
  ];
}

function randomChannel(seed: number, channel: number): number {
  const value = Math.sin((seed + 1) * (channel + 3) * 12.9898) * 43758.5453;

  return value - Math.floor(value);
}
