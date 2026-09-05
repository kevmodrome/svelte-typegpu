import { describe, expect, it } from 'vitest';
import { Dirty, hasDirty, mergeDirty } from './dirty';
import {
  dirtyForAttribute,
  dirtyForEventListener,
  dirtyForInsert,
  dirtyForRemove,
  normalizePrimitiveName,
  registerPrimitive
} from './primitives';

function expectExactDirty(mask: Dirty, ...flags: Dirty[]): void {
  expect(mask).toBe(mergeDirty(...flags));
}

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
    expect(normalizePrimitiveName('shader-pass')).toBe('shaderPass');
    expect(normalizePrimitiveName('unknown-node')).toBe('unknown-node');
  });

  it('marks scene render settings without forcing mesh rebuilds', () => {
    expectExactDirty(
      dirtyForAttribute('scene', 'clearColor', undefined, [0, 0, 0, 1]),
      Dirty.RenderSettings
    );
    expectExactDirty(dirtyForAttribute('scene', 'scale', 1, 1.5), Dirty.None);
    expectExactDirty(dirtyForAttribute('scene', 'animationSpeed', 1, 0.5), Dirty.None);
    expectExactDirty(dirtyForAttribute('scene', 'colorShift', 0, 47), Dirty.None);
    const dirty = dirtyForAttribute('scene', 'clearColor', [0, 0, 0, 1], [1, 1, 1, 1]);
    expect(hasDirty(dirty, Dirty.DrawBatches)).toBe(false);
  });

  it('distinguishes transform changes from independent instance and interaction edits', () => {
    const dirty = dirtyForAttribute('mesh', 'position', [0, 0, 0], [1, 2, 3]);

    expectExactDirty(dirty, Dirty.Transform, Dirty.Lights);
    expect(hasDirty(dirty, Dirty.Transform)).toBe(true);
    expect(hasDirty(dirty, Dirty.InstanceData)).toBe(false);
    expect(hasDirty(dirty, Dirty.Interaction)).toBe(false);
    expectExactDirty(
      dirtyForAttribute('mesh', 'quaternion', [0, 0, 0, 1], [0, 0.707, 0, 0.707]),
      Dirty.Transform,
      Dirty.Lights
    );
  });

  it('marks group transform and visibility changes as light-affecting', () => {
    expectExactDirty(
      dirtyForAttribute('group', 'position', [0, 0, 0], [1, 2, 3]),
      Dirty.Transform,
      Dirty.Lights
    );
    expectExactDirty(
      dirtyForAttribute('group', 'visible', true, false),
      Dirty.DrawBatches,
      Dirty.Interaction,
      Dirty.Lights,
      Dirty.ShaderPass,
      Dirty.FrameTasks
    );
    expectExactDirty(
      dirtyForAttribute('group', 'renderOrder', 0, 1),
      Dirty.DrawBatches,
      Dirty.Interaction,
      Dirty.Lights
    );
  });

  it('marks camera transform attributes as camera dirty only', () => {
    const dirty = dirtyForAttribute('perspectiveCamera', 'position', [0, 0, 0], [1, 2, 3]);

    expectExactDirty(dirty, Dirty.Camera);
    expect(hasDirty(dirty, Dirty.Camera)).toBe(true);
    expect(hasDirty(dirty, Dirty.Transform)).toBe(false);
    expect(hasDirty(dirty, Dirty.InstanceData)).toBe(false);
    expect(hasDirty(dirty, Dirty.Interaction)).toBe(false);
  });

  it('marks light transform attributes as lights dirty only', () => {
    const dirty = dirtyForAttribute('pointLight', 'position', [0, 0, 0], [1, 2, 3]);

    expectExactDirty(dirty, Dirty.Lights);
    expect(hasDirty(dirty, Dirty.Lights)).toBe(true);
    expect(hasDirty(dirty, Dirty.Transform)).toBe(false);
    expect(hasDirty(dirty, Dirty.InstanceData)).toBe(false);
    expect(hasDirty(dirty, Dirty.Interaction)).toBe(false);
  });

  it('marks model source and instance fields with exact masks', () => {
    expectExactDirty(
      dirtyForAttribute('model', 'src', '/models/a.glb', '/models/b.glb'),
      Dirty.Geometry,
      Dirty.DrawBatches,
      Dirty.Interaction
    );
    expectExactDirty(
      dirtyForAttribute('model', 'data', new ArrayBuffer(1), new ArrayBuffer(2)),
      Dirty.Geometry,
      Dirty.DrawBatches,
      Dirty.Interaction
    );
    expectExactDirty(dirtyForAttribute('mesh', 'phase', 0, 1), Dirty.None);
    expectExactDirty(dirtyForAttribute('mesh', 'spinSpeed', 0, 1), Dirty.None);
    expectExactDirty(dirtyForAttribute('mesh', 'color', [1, 1, 1, 1], [1, 0, 0, 1]), Dirty.MaterialUniform);
    expectExactDirty(dirtyForAttribute('shaderMaterial', 'uniforms', {}, { value0: 1 }), Dirty.MaterialUniform);
  });

  it('marks material replacement as a conservative material rebuild', () => {
    expectExactDirty(
      dirtyForAttribute('standardMaterial', 'material', {}, { color: [1, 0, 0, 1] }),
      Dirty.Material,
      Dirty.MaterialUniform,
      Dirty.Texture,
      Dirty.BindGroup,
      Dirty.Pipeline,
      Dirty.DrawBatches
    );
  });

  it('flows aliases through attribute dirtiness', () => {
    expectExactDirty(
      dirtyForAttribute('box-geometry', 'width', 1, 2),
      Dirty.Geometry,
      Dirty.DrawBatches,
      Dirty.Interaction
    );
    expectExactDirty(dirtyForAttribute('point-light', 'position', [0, 0, 0], [1, 2, 3]), Dirty.Lights);
  });

  it('returns no dirtiness when stable scalar values are Object.is-equal', () => {
    const material = { color: [1, 1, 1, 1] };

    expectExactDirty(dirtyForAttribute('scene', 'activeCamera', 'main', 'main'), Dirty.None);
    expectExactDirty(dirtyForAttribute('mesh', 'phase', Number.NaN, Number.NaN), Dirty.None);
    expectExactDirty(dirtyForAttribute('mesh', 'visible', true, true), Dirty.None);
    expectExactDirty(
      dirtyForAttribute('standardMaterial', 'material', material, material),
      Dirty.Material,
      Dirty.MaterialUniform,
      Dirty.Texture,
      Dirty.BindGroup,
      Dirty.Pipeline,
      Dirty.DrawBatches
    );
  });

  it('suppresses stable tuple values but not mutable object or callback values', () => {
    const position = [0, 0, 0];
    const material = { color: [1, 1, 1, 1] };

    expectExactDirty(dirtyForAttribute('mesh', 'position', position, position), Dirty.None);
    expectExactDirty(dirtyForAttribute('mesh', 'position', [0, 0, 0], [0, 0, 0]), Dirty.None);
    expectExactDirty(
      dirtyForAttribute('standardMaterial', 'material', material, material),
      Dirty.Material,
      Dirty.MaterialUniform,
      Dirty.Texture,
      Dirty.BindGroup,
      Dirty.Pipeline,
      Dirty.DrawBatches
    );
  });

  it('bridges transitional camera control nodes to camera dirtiness', () => {
    expectExactDirty(dirtyForAttribute('cameraPose', 'position', [0, 0, 0], [1, 2, 3]), Dirty.Camera);
    expectExactDirty(dirtyForAttribute('cameraLens', 'fov', 45, 60), Dirty.Camera);
    expectExactDirty(dirtyForAttribute('controls', 'mode', 'orbit', 'fly'), Dirty.Camera);
    expectExactDirty(dirtyForAttribute('pointerControls', 'rotateSpeed', 1, 2), Dirty.Camera);
    expectExactDirty(dirtyForAttribute('keyboardControls', 'moveStep', 0.25, 0.5), Dirty.Camera);
  });

  it('marks geometry, material, texture, and pipeline-affecting attributes distinctly', () => {
    expectExactDirty(
      dirtyForAttribute('boxGeometry', 'width', 1, 2),
      Dirty.Geometry,
      Dirty.DrawBatches,
      Dirty.Interaction
    );
    expectExactDirty(
      dirtyForAttribute('phongMaterial', 'color', [1, 1, 1, 1], [1, 0, 0, 1]),
      Dirty.MaterialUniform
    );
    expectExactDirty(
      dirtyForAttribute('phongMaterial', 'map', '/a.png', '/b.png'),
      Dirty.Material,
      Dirty.Texture,
      Dirty.BindGroup,
      Dirty.DrawBatches
    );
    expectExactDirty(
      dirtyForAttribute('standardMaterial', 'transparent', false, true),
      Dirty.Material,
      Dirty.Pipeline,
      Dirty.DrawBatches
    );
    expectExactDirty(
      dirtyForAttribute('texture', 'src', '/a.png', '/b.png'),
      Dirty.Texture,
      Dirty.BindGroup,
      Dirty.DrawBatches
    );
    expectExactDirty(
      dirtyForAttribute('sampler', 'minFilter', 'nearest', 'linear'),
      Dirty.Sampler,
      Dirty.BindGroup,
      Dirty.DrawBatches
    );
  });

  it('marks insert, remove, and interaction listeners', () => {
    expectExactDirty(dirtyForInsert('mesh'), Dirty.Tree, Dirty.DrawBatches, Dirty.Interaction);
    expectExactDirty(dirtyForRemove('pointLight'), Dirty.Tree, Dirty.Lights);
    expectExactDirty(dirtyForInsert('group'), Dirty.Tree, Dirty.DrawBatches, Dirty.Interaction, Dirty.Lights);
    expectExactDirty(dirtyForRemove('group'), Dirty.Tree, Dirty.DrawBatches, Dirty.Interaction, Dirty.Lights);
    expectExactDirty(
      dirtyForInsert('sampler'),
      Dirty.Tree,
      Dirty.Sampler,
      Dirty.BindGroup,
      Dirty.DrawBatches
    );
    expectExactDirty(dirtyForInsert('cameraPose'), Dirty.Tree, Dirty.Camera);
    expectExactDirty(dirtyForRemove('cameraLens'), Dirty.Tree, Dirty.Camera);
    expectExactDirty(dirtyForInsert('controls'), Dirty.Tree, Dirty.Camera);
    expectExactDirty(dirtyForRemove('pointerControls'), Dirty.Tree, Dirty.Camera);
    expectExactDirty(dirtyForInsert('keyboardControls'), Dirty.Tree, Dirty.Camera);
    expectExactDirty(dirtyForEventListener('mesh', 'click'), Dirty.Interaction);
    expectExactDirty(dirtyForEventListener('mesh', 'dragmove'), Dirty.Interaction);
    expectExactDirty(dirtyForEventListener('mesh', 'keydown'), Dirty.None);
    expectExactDirty(dirtyForAttribute('mesh', 'drag', undefined, 'rotate'), Dirty.Interaction);
  });

  it('marks shaderPass primitive changes without creating mesh dirtiness', () => {
    const previousFragment = () => null;
    const nextFragment = () => null;

    expectExactDirty(dirtyForInsert('shaderPass'), Dirty.Tree, Dirty.ShaderPass);
    expectExactDirty(dirtyForRemove('shader-pass'), Dirty.Tree, Dirty.ShaderPass);
    expectExactDirty(
      dirtyForAttribute('shaderPass', 'fragment', previousFragment, nextFragment),
      Dirty.ShaderPass
    );
    expectExactDirty(
      dirtyForAttribute('shaderPass', 'uniforms', { time: 'time' }, { resolution: 'resolution' }),
      Dirty.ShaderPass
    );
    expectExactDirty(dirtyForAttribute('shaderPass', 'active', true, false), Dirty.ShaderPass);
    expectExactDirty(dirtyForAttribute('shaderPass', 'renderOrder', 0, 1), Dirty.ShaderPass);
    expect(hasDirty(dirtyForAttribute('shaderPass', 'renderOrder', 0, 1), Dirty.DrawBatches)).toBe(
      false
    );
  });

  it('allows custom primitive descriptors to own dirtiness', () => {
    registerPrimitive({
      kind: 'customThing',
      dirtyForAttribute(attribute) {
        return attribute === 'mode' ? Dirty.Pipeline : Dirty.None;
      },
      dirtyForInsert() {
        return Dirty.Tree;
      },
      dirtyForRemove() {
        return Dirty.Tree;
      },
      dirtyForEventListener(eventName) {
        return eventName === 'activate' ? Dirty.Interaction : Dirty.None;
      }
    });

    expectExactDirty(dirtyForAttribute('customThing', 'mode', 'a', 'b'), Dirty.Pipeline);
    expectExactDirty(dirtyForAttribute('customThing', 'other', 'a', 'b'), Dirty.None);
    expectExactDirty(dirtyForInsert('customThing'), Dirty.Tree);
    expectExactDirty(dirtyForRemove('customThing'), Dirty.Tree);
    expectExactDirty(dirtyForEventListener('customThing', 'activate'), Dirty.Interaction);
  });

  it('treats Dirty.All as every known dirty bit', () => {
    expect(Dirty.All).toBe(-1);
    expect(hasDirty(Dirty.All, Dirty.Tree)).toBe(true);
    expect(hasDirty(Dirty.All, Dirty.Sampler)).toBe(true);
    expect(hasDirty(Dirty.All, Dirty.RenderSettings)).toBe(true);
  });
});
