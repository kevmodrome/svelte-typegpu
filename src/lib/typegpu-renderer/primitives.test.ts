import { describe, expect, it } from 'vitest';
import { Dirty, hasDirty } from './dirty';
import {
  dirtyForAttribute,
  dirtyForEventListener,
  dirtyForInsert,
  dirtyForRemove,
  normalizePrimitiveName
} from './primitives';

describe('TypeGPU primitive descriptors', () => {
  it('normalizes public primitive aliases', () => {
    expect(normalizePrimitiveName('perspective-camera')).toBe('perspectiveCamera');
    expect(normalizePrimitiveName('orthographic-camera')).toBe('orthographicCamera');
    expect(normalizePrimitiveName('orbit-controls')).toBe('orbitControls');
    expect(normalizePrimitiveName('box-geometry')).toBe('boxGeometry');
    expect(normalizePrimitiveName('plane-geometry')).toBe('planeGeometry');
    expect(normalizePrimitiveName('sphere-geometry')).toBe('sphereGeometry');
    expect(normalizePrimitiveName('buffer-geometry')).toBe('bufferGeometry');
    expect(normalizePrimitiveName('basic-material')).toBe('basicMaterial');
    expect(normalizePrimitiveName('phong-material')).toBe('phongMaterial');
    expect(normalizePrimitiveName('standard-material')).toBe('standardMaterial');
    expect(normalizePrimitiveName('instanced-mesh')).toBe('instancedMesh');
    expect(normalizePrimitiveName('unknown-node')).toBe('unknown-node');
  });

  it('marks scene render settings without forcing mesh rebuilds', () => {
    const dirty = dirtyForAttribute('scene', 'clearColor', undefined, [0, 0, 0, 1]);

    expect(hasDirty(dirty, Dirty.RenderSettings)).toBe(true);
    expect(hasDirty(dirty, Dirty.DrawBatches)).toBe(false);
  });

  it('marks transform attributes as transform, instance, and interaction dirty', () => {
    const dirty = dirtyForAttribute('mesh', 'position', [0, 0, 0], [1, 2, 3]);

    expect(hasDirty(dirty, Dirty.Transform)).toBe(true);
    expect(hasDirty(dirty, Dirty.InstanceData)).toBe(true);
    expect(hasDirty(dirty, Dirty.Interaction)).toBe(true);
  });

  it('marks geometry, material, texture, and pipeline-affecting attributes distinctly', () => {
    expect(hasDirty(dirtyForAttribute('boxGeometry', 'width', 1, 2), Dirty.Geometry)).toBe(true);
    expect(hasDirty(dirtyForAttribute('boxGeometry', 'width', 1, 2), Dirty.DrawBatches)).toBe(true);
    expect(
      hasDirty(
        dirtyForAttribute('phongMaterial', 'color', [1, 1, 1, 1], [1, 0, 0, 1]),
        Dirty.MaterialUniform
      )
    ).toBe(true);
    expect(hasDirty(dirtyForAttribute('phongMaterial', 'map', '/a.png', '/b.png'), Dirty.Texture)).toBe(
      true
    );
    expect(
      hasDirty(dirtyForAttribute('phongMaterial', 'map', '/a.png', '/b.png'), Dirty.BindGroup)
    ).toBe(true);
    expect(hasDirty(dirtyForAttribute('standardMaterial', 'transparent', false, true), Dirty.Pipeline)).toBe(
      true
    );
  });

  it('marks insert, remove, and interaction listeners', () => {
    expect(hasDirty(dirtyForInsert('mesh'), Dirty.DrawBatches)).toBe(true);
    expect(hasDirty(dirtyForInsert('mesh'), Dirty.Interaction)).toBe(true);
    expect(hasDirty(dirtyForRemove('pointLight'), Dirty.Lights)).toBe(true);
    expect(hasDirty(dirtyForEventListener('mesh', 'click'), Dirty.Interaction)).toBe(true);
    expect(hasDirty(dirtyForEventListener('mesh', 'keydown'), Dirty.Interaction)).toBe(false);
  });
});
