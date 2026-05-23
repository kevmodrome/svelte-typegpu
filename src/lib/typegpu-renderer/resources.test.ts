import { describe, expect, it } from 'vitest';
import { createElement, createFragment, insert, setAttribute } from './core';
import {
  collectSceneResources,
  readInlineGeometry,
  readInlineMaterial,
  resolveGeometryReference,
  resolveMaterialReference
} from './resources';
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
      layoutKey: 'position:normal:uv'
    });
    expect(geometry?.vertexFloats).toBe(8);
    expect(geometry?.vertexCount).toBe(36);
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
      layoutKey: 'position:normal:uv'
    });
    expect(geometry?.vertexFloats).toBe(8);
    expect(geometry?.vertexCount).toBe(6);
  });

  it('reads inline buffer geometry with explicit vertex data and bounds', () => {
    const vertices = new Float32Array([
      -1, 0, -1, 0, 1, 0, 0, 0,
      1, 0, -1, 0, 1, 0, 1, 0,
      0, 0, 1, 0, 1, 0, 0.5, 1
    ]);
    const bounds = { min: [-1, 0, -1], max: [1, 0, 1] };
    const node = createElement('bufferGeometry');
    setAttribute(node, 'key', 'triangle');
    setAttribute(node, 'vertices', vertices);
    setAttribute(node, 'bounds', bounds);

    const geometry = readInlineGeometry(node);

    expect(geometry).toMatchObject({
      key: 'triangle',
      kind: 'buffer',
      bounds,
      vertexCount: 3,
      vertexFloats: 8
    });
    expect(geometry?.vertexData).not.toBe(vertices);
    expect(Array.from(geometry?.vertexData ?? [])).toEqual(Array.from(vertices));

    vertices[0] = 99;
    expect(geometry?.vertexData[0]).toBe(-1);

    bounds.min[0] = -99;
    expect(geometry?.bounds?.min[0]).toBe(-1);
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
      key: 'texture:checker',
      src: '/textures/checker.png'
    });
    expect(resources.samplers.get('repeatLinear')?.key).toBe('sampler:repeatLinear');
    expect(resources.materials.get('crate')).toMatchObject({
      kind: 'phong',
      textureKey: 'texture:checker',
      samplerKey: 'sampler:repeatLinear'
    });

    expect(resolveGeometryReference('cube', resources)?.key).toBe('box:1:1:1');

    const resolvedMaterial = resolveMaterialReference('crate', resources);
    expect(resolvedMaterial?.textureKey).toBe('texture:checker');
    expect(resources.liveResourceKeys.geometries.has('box:1:1:1')).toBe(true);
    expect(resources.liveResourceKeys.materials.has(resolvedMaterial!.key!)).toBe(true);
    expect(resources.liveResourceKeys.textures.has('texture:checker')).toBe(true);
    expect(resources.liveResourceKeys.samplers.has('sampler:repeatLinear')).toBe(true);
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
