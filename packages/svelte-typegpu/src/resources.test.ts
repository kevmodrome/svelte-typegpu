import { describe, expect, it } from 'vitest';
import { createElement, createFragment, insert, setAttribute } from './core';
import {
  collectSceneResources,
  readInlineGeometry,
  readInlineMaterial,
  resolveGeometryReference,
  resolveMaterialReference
} from './resources';
import { MESH_VERTEX_FLOATS, MESH_VERTEX_LAYOUT_KEY } from './instance-data';
import type { TypeGpuStandardMaterialDescriptor } from './types';

describe('TypeGPU resource descriptors', () => {
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
      layoutKey: MESH_VERTEX_LAYOUT_KEY
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
      layoutKey: MESH_VERTEX_LAYOUT_KEY
    });
    expect(geometry?.vertexFloats).toBe(MESH_VERTEX_FLOATS);
    expect(geometry?.vertexCount).toBe(6);
    expect(Array.from(geometry?.vertexData.slice(8, 12) ?? [])).toEqual([1, 1, 1, 1]);
  });

  it('reads inline buffer geometry with explicit vertex data and bounds', () => {
    const vertices = new Float32Array([
      -1, 0, -1, 0, 1, 0, 0, 0, 1, 0, 0, 1,
      1, 0, -1, 0, 1, 0, 1, 0, 0, 1, 0, 1,
      0, 0, 1, 0, 1, 0, 0.5, 1, 0, 0, 1, 1
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
      layoutKey: MESH_VERTEX_LAYOUT_KEY
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

  it('rejects ambiguous legacy 8-float buffer geometry without a canonical layout declaration', () => {
    const node = createElement('bufferGeometry');
    setAttribute(node, 'key', 'ambiguous-legacy');
    setAttribute(
      node,
      'vertices',
      new Float32Array([
        -1, 0, -1, 0, 1, 0, 0, 0,
        1, 0, -1, 0, 1, 0, 1, 0,
        0, 0, 1, 0, 1, 0, 0.5, 1,
        -1, 0, -1, 0, 1, 0, 0, 0,
        1, 0, -1, 0, 1, 0, 1, 0,
        0, 0, 1, 0, 1, 0, 0.5, 1,
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

  it('collects reusable scene resources and resolves references', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const geometry = createElement('boxGeometry');
    const texture = createElement('texture');
    const sampler = createElement('sampler');
    const material = createElement('phongMaterial');

    setAttribute(geometry, 'id', 'cube');
    setAttribute(texture, 'id', 'checker');
    setAttribute(texture, 'src', '/textures/checker.png');
    setAttribute(sampler, 'id', 'repeatLinear');
    setAttribute(sampler, 'addressModeU', 'repeat');
    setAttribute(sampler, 'addressModeV', 'repeat');
    setAttribute(sampler, 'minFilter', 'linear');
    setAttribute(sampler, 'magFilter', 'linear');
    setAttribute(material, 'id', 'crate');
    setAttribute(material, 'map', 'checker');
    setAttribute(material, 'sampler', 'repeatLinear');

    insert(scene, geometry, null);
    insert(scene, texture, null);
    insert(scene, sampler, null);
    insert(scene, material, null);
    insert(root, scene, null);

    const resources = collectSceneResources(root);

    expect(resources.geometries.get('cube')?.key).toBe('box:1:1:1');
    expect(resources.textures.get('checker')).toMatchObject({
      kind: 'url',
      key: expect.stringMatching(/^texture:checker@rev:\d+$/),
      src: '/textures/checker.png'
    });
    expect(resources.samplers.get('repeatLinear')?.key).toMatch(/^sampler:repeatLinear@rev:\d+$/);
    expect(resources.materials.get('crate')).toMatchObject({
      kind: 'phong',
      textureKey: expect.stringMatching(/^texture:checker@rev:\d+$/),
      samplerKey: expect.stringMatching(/^sampler:repeatLinear@rev:\d+$/)
    });

    expect(resolveGeometryReference('cube', resources)?.key).toBe('box:1:1:1');

    const resolvedMaterial = resolveMaterialReference('crate', resources);
    expect(resolvedMaterial?.textureKey).toMatch(/^texture:checker@rev:\d+$/);
    expect(resources.liveResourceKeys.geometries.has('box:1:1:1')).toBe(true);
    expect(resources.liveResourceKeys.materials.has(resolvedMaterial!.key!)).toBe(true);
    expect([...resources.liveResourceKeys.textures].some((key) => key.startsWith('texture:checker@rev:'))).toBe(true);
    expect([...resources.liveResourceKeys.samplers].some((key) => key.startsWith('sampler:repeatLinear@rev:'))).toBe(true);
  });

  it('versions mutable reusable texture and buffer geometry identities', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const texture = createElement('texture');
    const geometry = createElement('bufferGeometry');
    const bounds = { min: [0, 0, 0], max: [1, 1, 1] };

    setAttribute(texture, 'id', 'albedo');
    setAttribute(texture, 'src', '/textures/a.png');
    setAttribute(geometry, 'id', 'triangle');
    setAttribute(geometry, 'key', 'triangle-buffer');
    setAttribute(geometry, 'layoutKey', MESH_VERTEX_LAYOUT_KEY);
    setAttribute(geometry, 'bounds', bounds);
    setAttribute(
      geometry,
      'vertices',
      new Float32Array([
        0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1,
        1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1,
        0, 1, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1
      ])
    );
    insert(scene, texture, null);
    insert(scene, geometry, null);
    insert(root, scene, null);

    const first = collectSceneResources(root);
    setAttribute(texture, 'src', '/textures/b.png');
    setAttribute(
      geometry,
      'vertices',
      new Float32Array([
        0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1,
        2, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1,
        0, 2, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1
      ])
    );
    const second = collectSceneResources(root);

    expect(second.textures.get('albedo')?.key).not.toBe(first.textures.get('albedo')?.key);
    expect(second.textures.get('albedo')).toMatchObject({ src: '/textures/b.png' });
    expect(second.geometries.get('triangle')?.key).not.toBe(
      first.geometries.get('triangle')?.key
    );
    expect(second.geometries.get('triangle')?.key).toContain('triangle-buffer');
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
