import { describe, expect, it } from 'vitest';
import { MESH_VERTEX_FLOATS } from './instance-data';
import {
  concatBytes,
  createGlbFixture,
  createInvalidGlbHeader,
  float32Bytes,
  uint16Bytes,
  uint32Bytes
} from './glb-test-fixtures';
import { loadGlbModel, parseGlbContainer } from './glb-loader';

describe('GLB loader', () => {
  it('parses a GLB v2 JSON chunk and binary chunk', () => {
    const binary = new Uint8Array([1, 2, 3, 4]);
    const parsed = parseGlbContainer(
      createGlbFixture({ asset: { version: '2.0' }, scenes: [] }, binary)
    );

    expect(parsed.json).toEqual({ asset: { version: '2.0' }, scenes: [] });
    expect(Array.from(parsed.binary)).toEqual([1, 2, 3, 4]);
  });

  it('rejects unsupported GLB versions', () => {
    expect(() => parseGlbContainer(createInvalidGlbHeader(1))).toThrow(
      'Unsupported GLB version 1'
    );
  });

  it('rejects GLB data that is too short', () => {
    expect(() => parseGlbContainer(new ArrayBuffer(12))).toThrow('GLB is too short.');
  });

  it('rejects invalid GLB magic', () => {
    const buffer = createGlbFixture({ asset: { version: '2.0' } });
    new DataView(buffer).setUint32(0, 0, true);

    expect(() => parseGlbContainer(buffer)).toThrow('Invalid GLB magic.');
  });

  it('rejects declared length mismatches', () => {
    const buffer = createGlbFixture({ asset: { version: '2.0' } });
    new DataView(buffer).setUint32(8, buffer.byteLength + 4, true);

    expect(() => parseGlbContainer(buffer)).toThrow(
      'GLB length does not match the buffer length.'
    );
  });

  it('rejects malformed chunk headers', () => {
    const buffer = withTrailingBytes(createGlbFixture({ asset: { version: '2.0' } }), 4);

    expect(() => parseGlbContainer(buffer)).toThrow('Malformed GLB chunk header.');
  });

  it('rejects malformed chunk lengths', () => {
    const buffer = createGlbFixture({ asset: { version: '2.0' } });
    new DataView(buffer).setUint32(12, buffer.byteLength, true);

    expect(() => parseGlbContainer(buffer)).toThrow('Malformed GLB chunk length.');
  });

  it('rejects GLB data without a JSON chunk', () => {
    const buffer = createGlbFixture({ asset: { version: '2.0' } });
    new DataView(buffer).setUint32(16, 0x004e4942, true);

    expect(() => parseGlbContainer(buffer)).toThrow('GLB JSON chunk is missing.');
  });

  it('trims JSON space padding before parsing', () => {
    const json = { asset: { version: '2.0' }, scenes: [] };
    expect(new TextEncoder().encode(JSON.stringify(json)).byteLength % 4).not.toBe(0);

    expect(parseGlbContainer(createGlbFixture(json)).json).toEqual(json);
  });

  it('returns an empty binary chunk when BIN is absent', () => {
    const parsed = parseGlbContainer(createGlbFixture({ asset: { version: '2.0' } }));

    expect(parsed.binary).toBeInstanceOf(Uint8Array);
    expect(parsed.binary.byteLength).toBe(0);
  });

  it('loads an indexed triangle into TypeGPU vertex data', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = float32Bytes([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = float32Bytes([0, 0, 1, 0, 0, 1]);
    const indices = uint16Bytes([0, 1, 2]);
    const binary = concatBytes([positions, normals, uvs, indices]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [
            {
              primitives: [
                {
                  attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
                  indices: 3
                }
              ]
            }
          ],
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength },
            {
              buffer: 0,
              byteOffset: positions.byteLength + normals.byteLength,
              byteLength: uvs.byteLength
            },
            {
              buffer: 0,
              byteOffset: positions.byteLength + normals.byteLength + uvs.byteLength,
              byteLength: indices.byteLength
            }
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
            { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' }
          ]
        },
        binary
      ),
      'model:test'
    );

    expect(model.meshes).toHaveLength(1);
    expect(model.meshes[0].geometry).toMatchObject({
      key: 'model:test:primitive:0',
      vertexCount: 3,
      vertexFloats: MESH_VERTEX_FLOATS
    });
    expect(Array.from(model.meshes[0].geometry.vertexData)).toEqual([
      0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1
    ]);
  });

  it('uses fallback UVs and generated flat normals when optional attributes are absent', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
        },
        positions
      ),
      'model:fallbacks'
    );

    expect(Array.from(model.meshes[0].geometry.vertexData.slice(3, 8))).toEqual([0, 0, 1, 0, 0]);
  });

  it('skips primitives with malformed accessor bounds', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
          accessors: [
            {
              bufferView: 0,
              byteOffset: positions.byteLength - Float32Array.BYTES_PER_ELEMENT,
              componentType: 5126,
              count: 3,
              type: 'VEC3'
            }
          ]
        },
        positions
      ),
      'model:malformed'
    );

    expect(model.meshes).toHaveLength(0);
  });

  it('skips primitives with malformed declared normals', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = float32Bytes([0, 0, 1, 0, 0, 1]);
    const binary = concatBytes([positions, normals]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength }
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }
          ]
        },
        binary
      ),
      'model:malformed-normals'
    );

    expect(model.meshes).toHaveLength(0);
  });

  it('skips primitives with short declared UVs', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const uvs = float32Bytes([0, 0, 1, 0]);
    const binary = concatBytes([positions, uvs]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] }],
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: uvs.byteLength }
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5126, count: 2, type: 'VEC2' }
          ]
        },
        binary
      ),
      'model:short-uvs'
    );

    expect(model.meshes).toHaveLength(0);
  });

  it('skips primitives with invalid declared indices', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = uint16Bytes([0, 1, 5]);
    const binary = concatBytes([positions, indices]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }
          ]
        },
        binary
      ),
      'model:bad-indices'
    );

    expect(model.meshes).toHaveLength(0);
  });

  it('skips primitives with non-number declared indices', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 'bad' }] }],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
        },
        positions
      ),
      'model:non-number-indices'
    );

    expect(model.meshes).toHaveLength(0);
  });

  it('skips primitives with non-triangle index counts', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = uint16Bytes([0, 1]);
    const binary = concatBytes([positions, indices]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5123, count: 2, type: 'SCALAR' }
          ]
        },
        binary
      ),
      'model:non-triangle-indices'
    );

    expect(model.meshes).toHaveLength(0);
  });

  it('skips primitives when a declared indices accessor cannot be decoded', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = uint16Bytes([0, 1, 2]);
    const binary = concatBytes([positions, indices]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5126, count: 3, type: 'SCALAR' }
          ]
        },
        binary
      ),
      'model:undecodable-indices'
    );

    expect(model.meshes).toHaveLength(0);
  });

  it('generates fallback flat normals per triangle', () => {
    const positions = float32Bytes([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      0, 0, 0, 0, 1, 0, 1, 0, 0
    ]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: 'VEC3' }]
        },
        positions
      ),
      'model:flat-normals'
    );
    const vertexData = model.meshes[0].geometry.vertexData;

    expect(Array.from(vertexData.slice(3, 6))).toEqual([0, 0, 1]);
    expect(
      Array.from(vertexData.slice(MESH_VERTEX_FLOATS * 3 + 3, MESH_VERTEX_FLOATS * 3 + 6))
    ).toEqual([0, 0, -1]);
  });

  it('loads uint32 indices', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = uint32Bytes([2, 1, 0]);
    const binary = concatBytes([positions, indices]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength }
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5125, count: 3, type: 'SCALAR' }
          ]
        },
        binary
      ),
      'model:uint32-indices'
    );

    expect(Array.from(model.meshes[0].geometry.vertexData.slice(0, 3))).toEqual([0, 1, 0]);
  });

  it('bakes node translation into imported vertex positions', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0, translation: [10, 0, 0] }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
        },
        positions
      ),
      'model:translated'
    );

    expect(Array.from(model.meshes[0].geometry.vertexData.slice(0, 3))).toEqual([10, 0, 0]);
  });

  it('bakes node rotation into imported vertex normals', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = float32Bytes([1, 0, 0, 1, 0, 0, 1, 0, 0]);
    const binary = concatBytes([positions, normals]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength }
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }
          ]
        },
        binary
      ),
      'model:rotated-normals'
    );

    expect(Array.from(model.meshes[0].geometry.vertexData.slice(3, 6))).toEqual([0, 1, 0]);
  });

  it('uses inverse-transpose normals for non-uniform node scale', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const normals = float32Bytes([1, 1, 0, 1, 1, 0, 1, 1, 0]);
    const binary = concatBytes([positions, normals]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0, scale: [2, 1, 1] }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength }
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
            { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' }
          ]
        },
        binary
      ),
      'model:scaled-normals'
    );

    const normal = Array.from(model.meshes[0].geometry.vertexData.slice(3, 6));
    expect(normal[0]).toBeCloseTo(0.4472136, 6);
    expect(normal[1]).toBeCloseTo(0.8944272, 6);
    expect(normal[2]).toBe(0);
  });

  it('reverses emitted winding for mirrored node transforms', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0, scale: [-1, 1, 1] }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
        },
        positions
      ),
      'model:mirrored'
    );
    const vertexData = model.meshes[0].geometry.vertexData;

    expect(Array.from(vertexData.slice(0, 3))).toEqual([0, 1, 0]);
    expect(Array.from(vertexData.slice(3, 6))).toEqual([0, 0, 1]);
    expect(Array.from(vertexData.slice(MESH_VERTEX_FLOATS, MESH_VERTEX_FLOATS + 3))).toEqual([
      -1, 0, 0
    ]);
  });

  it('maps metallic-roughness material fields and embedded base color textures', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const binary = concatBytes([positions, pngBytes]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: pngBytes.byteLength }
          ],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
          materials: [
            {
              pbrMetallicRoughness: {
                baseColorFactor: [0.2, 0.3, 0.4, 0.5],
                roughnessFactor: 0.7,
                metallicFactor: 0.8,
                baseColorTexture: { index: 0 }
              }
            }
          ],
          textures: [{ source: 0 }],
          images: [{ bufferView: 1, mimeType: 'image/png' }]
        },
        binary
      ),
      'model:material'
    );

    expect(model.meshes[0].material).toMatchObject({
      color: [0.2, 0.3, 0.4, 0.5],
      roughness: 0.7,
      metalness: 0.8,
      opacity: 1,
      map: {
        kind: 'embedded',
        key: 'model:material:image:0',
        mimeType: 'image/png'
      }
    });
    const map = model.meshes[0].material.map;
    expect(map?.kind).toBe('embedded');
    expect(Array.from(map?.kind === 'embedded' ? map.data : [])).toEqual([137, 80, 78, 71]);
  });

  it('uses glTF metallic-roughness defaults and keeps alpha only in color', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
          materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 0.5, 0.25, 0.125] } }]
        },
        positions
      ),
      'model:material-defaults'
    );

    expect(model.meshes[0].material).toMatchObject({
      color: [1, 0.5, 0.25, 0.125],
      roughness: 1,
      metalness: 1,
      opacity: 1
    });
  });

  it('uses glTF metallic-roughness defaults when primitive material is omitted', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
        },
        positions
      ),
      'model:no-material'
    );

    expect(model.meshes[0].material).toMatchObject({
      roughness: 1,
      metalness: 1
    });
  });

  it('ignores embedded base color textures with empty mime type or bytes', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: 0 }
          ],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
          materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
          textures: [{ source: 0 }],
          images: [{ bufferView: 1, mimeType: '' }]
        },
        positions
      ),
      'model:empty-image'
    );

    expect(model.meshes[0].material.map).toBeNull();
  });

  it('ignores embedded base color textures with empty byte data', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
            { buffer: 0, byteOffset: positions.byteLength, byteLength: 0 }
          ],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
          materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
          textures: [{ source: 0 }],
          images: [{ bufferView: 1, mimeType: 'image/png' }]
        },
        positions
      ),
      'model:empty-image-bytes'
    );

    expect(model.meshes[0].material.map).toBeNull();
  });

  it('skips unsupported primitive modes and missing position primitives', () => {
    const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const model = loadGlbModel(
      createGlbFixture(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [
            {
              primitives: [
                { mode: 1, attributes: { POSITION: 0 } },
                { attributes: { NORMAL: 0 } }
              ]
            }
          ],
          buffers: [{ byteLength: positions.byteLength }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
        },
        positions
      ),
      'model:skip'
    );

    expect(model.meshes).toEqual([]);
  });
});

function withTrailingBytes(input: ArrayBuffer, trailingByteLength: number): ArrayBuffer {
  const buffer = new ArrayBuffer(input.byteLength + trailingByteLength);
  new Uint8Array(buffer).set(new Uint8Array(input));
  new DataView(buffer).setUint32(8, buffer.byteLength, true);
  return buffer;
}
