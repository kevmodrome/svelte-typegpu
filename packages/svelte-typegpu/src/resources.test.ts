import { describe, expect, it } from 'vitest';
import tgpu, { d } from 'typegpu';
import { createElement, setAttribute } from './core';
import { readInlineGeometry, readInlineMaterial } from './resources';
import { MESH_VERTEX_FLOATS, MESH_VERTEX_LAYOUT_KEY } from './instance-data';
import type { TypeGpuStandardMaterialDescriptor } from './types';

describe('TypeGPU resource descriptors', () => {
  it('reuses geometry data until the geometry node changes', () => {
    const node = createElement('boxGeometry');
    const first = readInlineGeometry(node);

    expect(readInlineGeometry(node)).toBe(first);
    setAttribute(node, 'width', 3);
    const resized = readInlineGeometry(node);
    expect(resized).not.toBe(first);
    expect(resized?.bounds?.max[0]).toBe(1.5);
    expect(readInlineGeometry(node)).toBe(resized);
  });

  it('reads inline box geometry with stable key and bounds', () => {
    const node = createElement('boxGeometry');
    setAttribute(node, 'width', 2);
    setAttribute(node, 'height', 4);
    setAttribute(node, 'depth', 6);

    const geometry = readInlineGeometry(node);

    expect(geometry).toMatchObject({
      key: 'box:2:4:6',
      kind: 'box',
      bounds: { min: [-1, -2, -3], max: [1, 2, 3] },
      topology: 'triangle-list',
      layoutKey: MESH_VERTEX_LAYOUT_KEY,
      hasVertexAlpha: false
    });
    expect(geometry?.vertexFloats).toBe(MESH_VERTEX_FLOATS);
    expect(geometry?.vertexCount).toBe(36);
    expect(Array.from(geometry?.vertexData.slice(8, 12) ?? [])).toEqual([1, 1, 1, 1]);
  });

  it('reads inline plane geometry with segment defaults', () => {
    const node = createElement('planeGeometry');
    setAttribute(node, 'width', 8);
    setAttribute(node, 'height', 10);

    const geometry = readInlineGeometry(node);

    expect(geometry).toMatchObject({
      key: 'plane:8:10:1:1',
      kind: 'plane',
      bounds: { min: [-4, 0, -5], max: [4, 0, 5] },
      topology: 'triangle-list',
      layoutKey: MESH_VERTEX_LAYOUT_KEY,
      hasVertexAlpha: false
    });
    expect(geometry?.vertexFloats).toBe(MESH_VERTEX_FLOATS);
    expect(geometry?.vertexCount).toBe(6);
    expect(Array.from(geometry?.vertexData.slice(8, 12) ?? [])).toEqual([1, 1, 1, 1]);
  });

  it('reads inline buffer geometry with explicit vertex data and bounds', () => {
    const vertices = new Float32Array([
      -1, 0, -1, 0, 1, 0, 0, 0, 1, 0, 0, 1,
      1, 0, -1, 0, 1, 0, 1, 0, 0, 1, 0, 1,
      0, 0, 1, 0, 1, 0, 0.5, 1, 0, 0, 1, 0.5
    ]);
    const bounds = { min: [-1, 0, -1], max: [1, 0, 1] };
    const node = createElement('bufferGeometry');
    setAttribute(node, 'key', 'triangle');
    setAttribute(node, 'layoutKey', MESH_VERTEX_LAYOUT_KEY);
    setAttribute(node, 'vertices', vertices);
    setAttribute(node, 'bounds', bounds);

    const geometry = readInlineGeometry(node);

    expect(geometry).toMatchObject({
      key: 'triangle@rev:4',
      kind: 'buffer',
      bounds,
      vertexCount: 3,
      vertexFloats: MESH_VERTEX_FLOATS,
      layoutKey: MESH_VERTEX_LAYOUT_KEY,
      hasVertexAlpha: true
    });
    expect(geometry?.vertexData).not.toBe(vertices);
    expect(Array.from(geometry?.vertexData ?? [])).toEqual(Array.from(vertices));

    vertices[0] = 99;
    expect(geometry?.vertexData[0]).toBe(-1);

    bounds.min[0] = -99;
    expect(geometry?.bounds?.min[0]).toBe(-1);
  });

  it('rejects legacy 8-float non-indexed buffer geometry records', () => {
    const node = createElement('bufferGeometry');
    setAttribute(node, 'key', 'legacy-triangle');
    setAttribute(
      node,
      'vertices',
      new Float32Array([
        -1, 0, -1, 0, 1, 0, 0, 0,
        1, 0, -1, 0, 1, 0, 1, 0,
        0, 0, 1, 0, 1, 0, 0.5, 1
      ])
    );
    setAttribute(node, 'bounds', { min: [-1, 0, -1], max: [1, 0, 1] });

    expect(readInlineGeometry(node)).toBeNull();
  });

  it('reads inline indexed buffer geometry without mutating caller arrays', () => {
    const vertices = new Float32Array([
      -1, 0, -1, 0, 1, 0, 0, 0, 1, 0, 0, 1,
      1, 0, -1, 0, 1, 0, 1, 0, 0, 1, 0, 1,
      0, 0, 1, 0, 1, 0, 0.5, 1, 0, 0, 1, 1
    ]);
    const indices = new Uint16Array([0, 1, 2]);
    const node = createElement('bufferGeometry');

    setAttribute(node, 'id', 'indexed');
    setAttribute(node, 'vertexLayout', MESH_VERTEX_LAYOUT_KEY);
    setAttribute(node, 'vertices', vertices);
    setAttribute(node, 'indices', indices);
    setAttribute(node, 'bounds', { min: [-1, 0, -1], max: [1, 0, 1] });

    const geometry = readInlineGeometry(node);

    expect(geometry).toMatchObject({
      kind: 'buffer',
      indexCount: 3,
      indexFormat: 'uint16'
    });
    expect(geometry?.indexData).toBeInstanceOf(Uint16Array);
    expect(Array.from(geometry?.indexData ?? [])).toEqual([0, 1, 2]);

    indices[0] = 2;
    expect(geometry?.indexData?.[0]).toBe(0);
  });

  it('rejects indexed buffer geometry with invalid triangle indices', () => {
    const invalidCount = createElement('bufferGeometry');
    setAttribute(invalidCount, 'layoutKey', MESH_VERTEX_LAYOUT_KEY);
    setAttribute(invalidCount, 'vertices', new Float32Array([
      -1, 0, -1, 0, 1, 0, 0, 0, 1, 1, 1, 1,
      1, 0, -1, 0, 1, 0, 1, 0, 1, 1, 1, 1,
      0, 0, 1, 0, 1, 0, 0.5, 1, 1, 1, 1, 1
    ]));
    setAttribute(invalidCount, 'indices', new Uint16Array([0, 1]));
    setAttribute(invalidCount, 'bounds', { min: [-1, 0, -1], max: [1, 0, 1] });

    const outOfRange = createElement('bufferGeometry');
    setAttribute(outOfRange, 'layoutKey', MESH_VERTEX_LAYOUT_KEY);
    setAttribute(outOfRange, 'vertices', new Float32Array([
      -1, 0, -1, 0, 1, 0, 0, 0, 1, 1, 1, 1,
      1, 0, -1, 0, 1, 0, 1, 0, 1, 1, 1, 1
    ]));
    setAttribute(outOfRange, 'indices', new Uint16Array([0, 1, 2]));
    setAttribute(outOfRange, 'bounds', { min: [-1, 0, -1], max: [1, 0, 1] });

    expect(readInlineGeometry(invalidCount)).toBeNull();
    expect(readInlineGeometry(outOfRange)).toBeNull();
  });

  it('normalizes inline material descriptor variants', () => {
    const basic = createElement('basicMaterial');
    setAttribute(basic, 'color', [0.2, 0.4, 0.6]);
    setAttribute(basic, 'map', '/textures/basic.png');

    const phong = createElement('phongMaterial');
    setAttribute(phong, 'color', [0.1, 0.2, 0.3, 0.8]);
    setAttribute(phong, 'roughness', 0.3);
    setAttribute(phong, 'map', { kind: 'embedded', key: 'crate', mimeType: 'image/png', data: new Uint8Array([1]) });
    setAttribute(phong, 'sampler', { key: 'sampler:nearest', minFilter: 'nearest', magFilter: 'nearest' });

    const standard = createElement('standardMaterial');
    setAttribute(standard, 'metalness', 0.9);
    setAttribute(standard, 'roughness', 0.15);
    setAttribute(standard, 'opacity', 0.5);
    setAttribute(standard, 'transparent', true);

    expect(readInlineMaterial(basic)).toMatchObject({
      kind: 'basic',
      color: [0.2, 0.4, 0.6, 1],
      roughness: 1,
      metalness: 0,
      textureKey: 'url:/textures/basic.png',
      samplerKey: 'sampler:default',
      pipelineKey: expect.stringContaining('material:basic')
    });
    expect(readInlineMaterial(phong)).toMatchObject({
      kind: 'phong',
      color: [0.1, 0.2, 0.3, 0.8],
      roughness: 0.3,
      metalness: 0,
      textureKey: 'embedded:crate',
      samplerKey: 'sampler:nearest',
      pipelineKey: expect.stringContaining('material:phong')
    });
    expect(readInlineMaterial(standard)).toMatchObject({
      kind: 'standard',
      color: [1, 1, 1, 1],
      roughness: 0.15,
      metalness: 0.9,
      opacity: 0.5,
      transparent: true,
      textureKey: 'solid:white',
      samplerKey: 'sampler:default',
      pipelineKey: expect.stringContaining('material:standard')
    });
  });

  it('reads shader material fragments as custom mesh materials', () => {
    const fragment = tgpu
      .fragmentFn({
        in: {
          color: d.location(0, d.vec4f),
          normal: d.location(1, d.vec3f),
          material: d.location(2, d.vec4f),
          world_position: d.location(3, d.vec3f),
          uv: d.location(4, d.vec2f),
          vertex_color: d.location(5, d.vec4f),
          material_extra: d.location(6, d.vec4f)
        },
        out: d.vec4f
      })/* wgsl */ `{
        return vec4f(in.uv, 0.0, 1.0);
      }`
      .$name('customMeshFragmentFixture');
    const material = createElement('shaderMaterial');
    setAttribute(material, 'fragment', fragment);
    setAttribute(material, 'cullMode', 'none');

    expect(readInlineMaterial(material)).toMatchObject({
      kind: 'shader',
      fragment,
      cullMode: 'none',
      pipelineKey: expect.stringContaining('material:shader'),
      key: expect.stringContaining('material:shader')
    });
  });

  it('normalizes shader material uniforms without putting values in the pipeline key', () => {
    const fragment = tgpu
      .fragmentFn({
        in: {
          color: d.location(0, d.vec4f),
          normal: d.location(1, d.vec3f),
          material: d.location(2, d.vec4f),
          world_position: d.location(3, d.vec3f),
          uv: d.location(4, d.vec2f),
          vertex_color: d.location(5, d.vec4f),
          material_extra: d.location(6, d.vec4f)
        },
        out: d.vec4f
      })/* wgsl */ `{
        return vec4f(in.uv, 0.0, 1.0);
      }`
      .$name('customMeshUniformFragmentFixture');
    const first = createElement('shaderMaterial');
    const second = createElement('shaderMaterial');

    setAttribute(first, 'fragment', fragment);
    setAttribute(first, 'uniforms', {
      value0: 0.25,
      value1: [0.5, 0.75],
      value2: [0.1, 0.2, 0.3],
      value3: [0.2, 0.4, 0.6, 0.8],
      value8: [1, 1, 1, 1]
    });
    setAttribute(second, 'fragment', fragment);
    setAttribute(second, 'uniforms', {
      value0: 0.75
    });

    const firstMaterial = readInlineMaterial(first);
    const secondMaterial = readInlineMaterial(second);

    expect(firstMaterial).toMatchObject({
      kind: 'shader',
      uniforms: {
        value0: [0.25, 0, 0, 0],
        value1: [0.5, 0.75, 0, 0],
        value2: [0.1, 0.2, 0.3, 0],
        value3: [0.2, 0.4, 0.6, 0.8]
      }
    });
    expect(firstMaterial?.kind).toBe('shader');
    expect(secondMaterial?.kind).toBe('shader');
    if (firstMaterial?.kind !== 'shader' || secondMaterial?.kind !== 'shader') {
      throw new Error('Expected shader materials');
    }
    expect(firstMaterial.uniformKey).not.toBe(secondMaterial.uniformKey);
    expect(firstMaterial.pipelineKey).toBe(secondMaterial.pipelineKey);
  });

  it('keys inline sampler objects by normalized sampler fields', () => {
    const defaultSamplerMaterial = createElement('standardMaterial');
    const nearestSamplerMaterial = createElement('standardMaterial');
    setAttribute(nearestSamplerMaterial, 'sampler', { minFilter: 'nearest' });

    const defaultDescriptor = readInlineMaterial(defaultSamplerMaterial);
    const nearestDescriptor = readInlineMaterial(nearestSamplerMaterial);

    expect(defaultDescriptor?.samplerKey).toBe('sampler:default');
    expect(nearestDescriptor?.samplerKey).not.toBe('sampler:default');
    expect(nearestDescriptor?.samplerKey).toContain('min:nearest');
    expect(nearestDescriptor?.bindGroupKey).not.toBe(defaultDescriptor?.bindGroupKey);
  });

  it('keys inline data textures by deterministic content identity', () => {
    const first = createElement('standardMaterial');
    const second = createElement('standardMaterial');
    setAttribute(first, 'map', {
      kind: 'data',
      data: new Uint8Array([255, 0, 0, 255]),
      width: 1,
      height: 1,
      format: 'rgba8unorm'
    });
    setAttribute(second, 'map', {
      kind: 'data',
      data: new Uint8Array([0, 255, 0, 255]),
      width: 1,
      height: 1,
      format: 'rgba8unorm'
    });

    const firstDescriptor = readInlineMaterial(first);
    const secondDescriptor = readInlineMaterial(second);

    expect(firstDescriptor?.textureKey).toMatch(/^data:1:1:rgba8unorm:[a-f0-9]+$/);
    expect(secondDescriptor?.textureKey).toMatch(/^data:1:1:rgba8unorm:[a-f0-9]+$/);
    expect(firstDescriptor?.textureKey).not.toBe(secondDescriptor?.textureKey);
    expect(firstDescriptor?.bindGroupKey).not.toBe(secondDescriptor?.bindGroupKey);
  });

  it('ignores public id when deriving procedural geometry keys', () => {
    const first = createElement('boxGeometry');
    const second = createElement('boxGeometry');

    setAttribute(first, 'id', 'first-name');
    setAttribute(second, 'id', 'second-name');
    setAttribute(first, 'width', 2);
    setAttribute(second, 'width', 2);

    expect(readInlineGeometry(first)?.key).toBe('box:2:1:1');
    expect(readInlineGeometry(second)?.key).toBe('box:2:1:1');
  });

  it('reads buffer geometry without a public layoutKey', () => {
    const vertices = new Float32Array([
      -1, 0, -1, 0, 1, 0, 0, 0, 1, 1, 1, 1,
      1, 0, -1, 0, 1, 0, 1, 0, 1, 1, 1, 1,
      0, 0, 1, 0, 1, 0, 0.5, 1, 1, 1, 1, 1
    ]);
    const node = createElement('bufferGeometry');

    setAttribute(node, 'key', 'terrain:v1');
    setAttribute(node, 'vertices', vertices);
    setAttribute(node, 'bounds', { min: [-1, 0, -1], max: [1, 0, 1] });

    expect(readInlineGeometry(node)).toMatchObject({
      key: 'terrain:v1@rev:3',
      kind: 'buffer',
      vertexCount: 3
    });
  });

  it('automatically reuses buffer geometry identity for the same typed arrays', () => {
    const vertices = new Float32Array([
      -1, 0, -1, 0, 1, 0, 0, 0, 1, 1, 1, 1,
      1, 0, -1, 0, 1, 0, 1, 0, 1, 1, 1, 1,
      0, 0, 1, 0, 1, 0, 0.5, 1, 1, 1, 1, 1
    ]);
    const bounds = { min: [-1, 0, -1], max: [1, 0, 1] };
    const first = createElement('bufferGeometry');
    const second = createElement('bufferGeometry');

    setAttribute(first, 'vertices', vertices);
    setAttribute(first, 'bounds', bounds);
    setAttribute(second, 'vertices', vertices);
    setAttribute(second, 'bounds', bounds);

    expect(readInlineGeometry(first)?.key).toBe(readInlineGeometry(second)?.key);
    expect(readInlineGeometry(first)?.key).toMatch(/^buffer:auto:/);
  });

  it('gives changed vertex data and different index arrays distinct GPU cache keys', () => {
    const vertices = new Float32Array(36);
    const nodes = [createElement('bufferGeometry'), createElement('bufferGeometry')];
    for (const node of nodes) {
      setAttribute(node, 'vertices', vertices);
      setAttribute(node, 'bounds', { min: [0, 0, 0], max: [1, 1, 1] });
    }
    setAttribute(nodes[0], 'indices', new Uint16Array([0, 1, 2]));
    setAttribute(nodes[1], 'indices', new Uint16Array([2, 1, 0]));
    const first = readInlineGeometry(nodes[0])!;
    expect(readInlineGeometry(nodes[1])?.key).not.toBe(first.key);

    vertices[0] = 0.5;
    setAttribute(nodes[0], 'vertices', vertices);
    const updated = readInlineGeometry(nodes[0])!;
    expect(updated.key).not.toBe(first.key);
    expect(updated.vertexData[0]).toBe(0.5);
  });
});

const standardOnlyMaterial: TypeGpuStandardMaterialDescriptor = {
  // @ts-expect-error TypeGpuStandardMaterialDescriptor must not accept non-standard material kinds.
  kind: 'basic',
  color: [1, 1, 1, 1],
  opacity: 1,
  roughness: 1,
  metalness: 0,
  map: null
};

void standardOnlyMaterial;
