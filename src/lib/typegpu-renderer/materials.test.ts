import { describe, expect, it } from 'vitest';
import { createMaterialDescriptor } from './material-descriptors';
import { textureKeyForMaterial, textureSource } from './materials';
import type { TypeGpuEmbeddedTextureSource, TypeGpuStandardMaterialDescriptor } from './types';

describe('TypeGPU material helpers', () => {
  it('normalizes embedded texture sources', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const source = textureSource({
      kind: 'embedded',
      key: 'model:chair:image:0',
      mimeType: 'image/png',
      data
    });

    expect(source).toEqual({
      kind: 'embedded',
      key: 'model:chair:image:0',
      mimeType: 'image/png',
      data
    });
  });

  it('keys embedded material textures by stable embedded key', () => {
    const map: TypeGpuEmbeddedTextureSource = {
      kind: 'embedded',
      key: 'model:chair:image:0',
      mimeType: 'image/png',
      data: new Uint8Array([1, 2, 3, 4])
    };
    const material: TypeGpuStandardMaterialDescriptor = {
      kind: 'standard',
      color: [1, 1, 1, 1],
      roughness: 0.45,
      metalness: 0.05,
      opacity: 1,
      map
    };

    expect(textureKeyForMaterial(material)).toBe('embedded:model:chair:image:0');
  });

  it('keeps texture, sampler, material, bind group, and pipeline keys separate', () => {
    const material = createMaterialDescriptor('phong', {
      color: [1, 1, 1, 1],
      map: '/textures/a.png',
      sampler: 'repeatLinear',
      transparent: true
    });

    expect(material.textureKey).toBe('url:/textures/a.png');
    expect(material.samplerKey).toBe('sampler:repeatLinear');
    expect(material.key).toContain('material:phong');
    expect(material.key).not.toBe(material.textureKey);
    expect(material.key).not.toBe(material.samplerKey);
    expect(material.bindGroupKey).toContain('url:/textures/a.png');
    expect(material.bindGroupKey).toContain('sampler:repeatLinear');
    expect(material.pipelineKey).toContain('blend:alpha');
    expect(material.pipelineKey).not.toContain('url:/textures/a.png');
  });
});
