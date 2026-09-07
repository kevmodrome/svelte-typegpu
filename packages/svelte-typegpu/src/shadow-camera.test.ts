import { describe, expect, it } from 'vitest';
import { createLocalShadowMatrix, localShadowDistance, shadowCameraDepth } from './shadow-camera';
import { createDirectionalShadowViewProjection, shadowBoundsForDrawBatches, shadowDepthForPoint } from './gpu-renderer';
import { createViewProjectionMatrix } from './camera';
import { invert4, transformPoint4 } from './math3d';
import { Frustum } from './frustum';
import { VisibilitySelection } from './batch-visibility';
import { createDrawBatchCache } from './draw-batch-cache';
import { createElement, createFragment, insert, setAttribute } from './core';
import { collectLights } from './lights';
import { createMaterialDescriptor } from './material-descriptors';
import { createBoxGeometryData } from './geometries';
import { transformBounds } from './bounds';
import type { TypeGpuCameraSettings, TypeGpuLight, TypeGpuMeshDrawItem, Vector3Tuple } from './types';

const camera: TypeGpuCameraSettings = { projection: 'perspective', position: [0, 0, 10], target: [0, 0, 0], fov: 60, near: 0.1, far: 1000 };
const light = { direction: [0, -1, 0], shadowMapSize: 2048, shadowDistance: 40 } as TypeGpuLight;
const geometry = createBoxGeometryData(1, 1, 1), material = createMaterialDescriptor('standard');
function item(position: Vector3Tuple, id: string): TypeGpuMeshDrawItem {
  const transform = { position, rotation: [0, 0, 0] as Vector3Tuple, scale: [1, 1, 1] as Vector3Tuple };
  return { id, node: createElement('mesh'), revision: 1, geometry, material, transform,
    bounds: transformBounds(geometry.bounds!, transform), color: [1, 1, 1, 1], renderOrder: 0,
    hitTest: 'bounds', pointerEvents: 'auto', castShadow: true, receiveShadow: true };
}

describe('camera-local directional shadows', () => {
  it.each(['perspective', 'orthographic'] as const)('encloses all truncated %s frustum corners at wide and narrow aspect ratios', projection => {
    for (const aspect of [0.5, 2.2]) {
      const input: TypeGpuCameraSettings = projection === 'perspective' ? camera : { ...camera, projection, fov: undefined, zoom: 0.1 };
      const matrix = createLocalShadowMatrix(light, input, aspect, null);
      const inverse = invert4(createViewProjectionMatrix(aspect, { ...input, far: 40 }))!;
      for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [0, 1]) {
        const point = transformPoint4(inverse, [x, y, z]);
        const clip = transformPoint4(matrix, point);
        expect(Math.abs(clip[0])).toBeLessThan(1);
        expect(Math.abs(clip[1])).toBeLessThan(1);
        expect(clip[2]).toBeGreaterThan(0); expect(clip[2]).toBeLessThan(1);
      }
    }
  });

  it('keeps scale invariant on rotation and snaps translation to whole shadow texels', () => {
    const matrix = createLocalShadowMatrix(light, camera, 1, null);
    const texel = 2 / Math.hypot(matrix[0], matrix[4], matrix[8]) / light.shadowMapSize;
    const translated = (x: number) => createLocalShadowMatrix(light, { ...camera, position: [x, 0, 10], target: [x, 0, 0] }, 1, null);
    expect(Array.from(translated(texel * 0.1), value => value + 0)).toEqual(Array.from(matrix, value => value + 0));
    expect(Math.abs(translated(texel)[12] - matrix[12])).toBeCloseTo(2 / light.shadowMapSize, 7);
    const rotated = createLocalShadowMatrix(light, { ...camera, target: [10, 0, 10] }, 1, null);
    for (const index of [0, 1, 4, 5, 8, 9]) expect(rotated[index]).toBe(matrix[index]);
  });

  it('retains upstream offscreen casters, culls irrelevant lateral casters, and never reads packed instances', () => {
    const cache = createDrawBatchCache();
    const offscreen = item([0, 100, 0], 'upstream'), lateral = item([500, 0, 0], 'lateral');
    const batch = cache.read([offscreen, lateral], false)[0];
    const instances = batch.instances, bounds = batch.visibility!, nodes = bounds.nodes;
    Object.defineProperty(batch, 'instances', { get() { throw new Error('Per-instance bounds scan'); }, configurable: true });
    const matrix = createDirectionalShadowViewProjection(light, [batch], camera, 1, true);
    const color = new Frustum(), shadow = new Frustum();
    color.setMatrix(createViewProjectionMatrix(1, camera)); shadow.setMatrix(matrix);
    const selected = new VisibilitySelection(); selected.select(shadow, bounds, 2);
    expect(color.classify(bounds.items, 0)).toBe(-1);
    expect(Array.from(selected.ranges.subarray(0, selected.rangeCount * 2))).toEqual([0, 1]);
    expect(shadowDepthForPoint(matrix, [0, 100, 0])).toBeLessThan(shadowDepthForPoint(matrix, [0, 0, 0]));
    expect(shadowBoundsForDrawBatches([batch], true)?.max[1]).toBe(100.5);
    Object.defineProperty(batch, 'instances', { value: instances, configurable: true });
    offscreen.transform.position[1] = 150; offscreen.bounds = transformBounds(geometry.bounds!, offscreen.transform); offscreen.revision++;
    cache.updateInstances([offscreen]);
    expect(shadowBoundsForDrawBatches([batch], true)?.max[1]).toBe(150.5);
    expect(batch.instances).toBe(instances); expect(batch.visibility!.nodes).toBe(nodes);
    expect(batch.dirtyRanges).toEqual([{ start: 0, count: 1 }]);
  });

  it('normalizes declarative policy and writes the camera-forward fade plane', () => {
    const root = createFragment(), node = createElement('directionalLight'); insert(root, node, null);
    for (const value of [undefined, 0, -1, NaN, Infinity, '40']) {
      setAttribute(node, 'shadowDistance', value);
      expect(collectLights(root)[0].shadowDistance).toBeUndefined();
    }
    setAttribute(node, 'shadowDistance', 40); setAttribute(node, 'shadowLod', true);
    expect(collectLights(root)[0]).toMatchObject({ shadowDistance: 40, shadowLod: true });
    expect(localShadowDistance({ ...light, shadowDistance: 2000 }, camera)).toBe(1000);
    const plane = new Float32Array(4); shadowCameraDepth(camera, plane);
    expect(Array.from(plane)).toEqual([0, 0, -1, 10]);
  });
});
