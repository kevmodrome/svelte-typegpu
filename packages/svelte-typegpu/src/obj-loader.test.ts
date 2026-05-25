import { describe, expect, it } from 'vitest';
import { MESH_VERTEX_FLOATS, MESH_VERTEX_LAYOUT_KEY } from './instance-data';
import { loadObjModel } from './obj-loader';

describe('OBJ loader', () => {
  it('loads a triangle into canonical TypeGPU vertex data', () => {
    const model = loadObjModel(
      `
v 0 0 0
v 1 0 0
v 0 1 0
vt 0 0
vt 1 0
vt 0 1
vn 0 0 1
f 1/1/1 2/2/1 3/3/1
`,
      'model:triangle'
    );

    expect(model.key).toBe('model:triangle');
    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].geometry).toMatchObject({
      key: 'model:triangle:primitive:0',
      kind: 'imported',
      vertexCount: 3,
      vertexFloats: MESH_VERTEX_FLOATS,
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
      topology: 'triangle-list',
      layoutKey: MESH_VERTEX_LAYOUT_KEY,
      hasVertexAlpha: false
    });
    expect(model.meshes[0].material).toMatchObject({
      kind: 'standard',
      color: [1, 1, 1, 1],
      roughness: 1,
      metalness: 1
    });
    expect(model.meshes[0].transform).toEqual({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    });
    expect(Array.from(model.meshes[0].geometry.vertexData)).toEqual([
      0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1,
      1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1,
      0, 1, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1
    ]);
  });

  it('triangulates quad faces with fan ordering', () => {
    const model = loadObjModel(
      `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`,
      'model:quad'
    );

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].geometry.vertexCount).toBe(6);
    expect(vertexPositions(model.meshes[0].geometry.vertexData)).toEqual([
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 0, 0],
      [1, 1, 0],
      [0, 1, 0]
    ]);
  });

  it('generates flat normals and default UVs and colors when attributes are missing', () => {
    const model = loadObjModel(
      `
v 0 0 0
v 2 0 0
v 0 2 0
f 1 2 3
`,
      'model:fallbacks'
    );

    expect(vertexNormals(model.meshes[0].geometry.vertexData)).toEqual([
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1]
    ]);
    expect(vertexUvs(model.meshes[0].geometry.vertexData)).toEqual([
      [0, 0],
      [0, 0],
      [0, 0]
    ]);
    expect(vertexColors(model.meshes[0].geometry.vertexData)).toEqual([
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1]
    ]);
  });

  it('resolves negative face indices relative to the current attribute lists', () => {
    const model = loadObjModel(
      `
v -1 0 0
v 0 1 0
v 1 0 0
vt 0 0
vt 0.5 1
vt 1 0
vn 0 0 1
f -3/-3/-1 -2/-2/-1 -1/-1/-1
`,
      'model:negative-indices'
    );

    expect(vertexPositions(model.meshes[0].geometry.vertexData)).toEqual([
      [-1, 0, 0],
      [0, 1, 0],
      [1, 0, 0]
    ]);
    expect(vertexUvs(model.meshes[0].geometry.vertexData)).toEqual([
      [0, 0],
      [0.5, 1],
      [1, 0]
    ]);
  });

  it('skips malformed faces without emitting non-canonical geometry', () => {
    const model = loadObjModel(
      `
v 0 0 0
v 1 0 0
f 1 2 3
`,
      'model:malformed'
    );

    expect(model.meshes).toHaveLength(0);
  });
});

function vertexPositions(vertexData: Float32Array): number[][] {
  return readVertexComponents(vertexData, 0, 3);
}

function vertexNormals(vertexData: Float32Array): number[][] {
  return readVertexComponents(vertexData, 3, 3);
}

function vertexUvs(vertexData: Float32Array): number[][] {
  return readVertexComponents(vertexData, 6, 2);
}

function vertexColors(vertexData: Float32Array): number[][] {
  return readVertexComponents(vertexData, 8, 4);
}

function readVertexComponents(
  vertexData: Float32Array,
  componentOffset: number,
  componentCount: number
): number[][] {
  const values: number[][] = [];
  for (let index = 0; index < vertexData.length; index += MESH_VERTEX_FLOATS) {
    values.push(
      Array.from(vertexData.slice(index + componentOffset, index + componentOffset + componentCount))
    );
  }
  return values;
}
