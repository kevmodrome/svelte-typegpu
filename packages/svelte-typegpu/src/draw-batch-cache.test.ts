import { describe, expect, it } from 'vitest';
import { createElement } from './core';
import { createDrawBatchCache } from './draw-batch-cache';
import { MESH_VERTEX_FLOATS, MESH_VERTEX_LAYOUT_KEY } from './instance-data';
import type {
  TypeGpuGeometryData,
  TypeGpuMaterialDescriptor,
  TypeGpuMeshDrawItem
} from './types';

describe('TypeGPU draw batch cache', () => {
  it('reuses backing capacity on append, shrink, and reorder; grows only when full', () => {
    const cache = createDrawBatchCache();
    const items = ['a', 'b', 'c', 'd', 'e'].map(id => drawItem({ id }));
    const first = cache.read(items.slice(0, 3))[0];
    expect(first.instances.length).toBe(3 * 24);
    expect(first.instances.buffer.byteLength).toBe(4 * 96);
    const appended = cache.read(items.slice(0, 4))[0];
    expect(appended.instances.buffer).toBe(first.instances.buffer);
    expect(appended.dirtyRanges).toEqual([{ start: 3, count: 1 }]);
    const shrunk = cache.read(items.slice(0, 2))[0];
    expect(shrunk.instances.buffer).toBe(first.instances.buffer);
    expect(shrunk.dirtyRanges).toEqual([]);
    expect(shrunk.instanceCount).toBe(2);
    const reordered = cache.read([items[1], items[0]])[0];
    expect(reordered.instances.buffer).toBe(first.instances.buffer);
    expect(reordered.instanceIds).toEqual(['b', 'a']);
    expect(reordered.dirtyRanges).toEqual([{ start: 0, count: 2 }]);
    const grown = cache.read(items)[0];
    expect(grown.instances.buffer).not.toBe(first.instances.buffer);
    expect(grown.instances.buffer.byteLength).toBe(8 * 96);
    expect(grown.dirtyRanges).toEqual([{ start: 0, count: 5 }]);
    cache.read([]);
    expect(cache.read(items)[0].instances.buffer).not.toBe(grown.instances.buffer);
  });
  it('uses the exact Task 5 batch key shape', () => {
    const [batch] = createDrawBatchCache().read([drawItem({ id: 'a' })]);

    expect(batch.key).toBe(
      'pass:main|pipeline:standard:opaque|material:standard:white|bind:solid|box:1:1:1|order:0'
    );
    expect(batch.passKey).toBe('pass:main');
    expect(batch.pipelineKey).toBe('pipeline:standard:opaque');
    expect(batch.materialKey).toBe('material:standard:white');
    expect(batch.bindGroupKey).toBe('bind:solid');
    expect(batch.geometryKey).toBe('box:1:1:1');
  });

  it('separates groups by pipeline, material, bind group, geometry, and render order', () => {
    const batches = createDrawBatchCache().read([
      drawItem({ id: 'opaque-a' }),
      drawItem({ id: 'pipeline', pipelineKey: 'pipeline:standard:alpha' }),
      drawItem({ id: 'material', materialKey: 'material:standard:red' }),
      drawItem({ id: 'bind', bindGroupKey: 'bind:textured' }),
      drawItem({ id: 'geometry', geometry: geometryData('sphere:0.5:16:8') }),
      drawItem({ id: 'order', renderOrder: 2 })
    ]);

    expect(batches).toHaveLength(6);
    expect(new Set(batches.map((batch) => batch.key)).size).toBe(6);
  });

  it('separates shadow casters from visually identical non-casters', () => {
    const batches = createDrawBatchCache().read([
      drawItem({ id: 'plain' }),
      drawItem({ id: 'caster', castShadow: true })
    ]);

    expect(batches).toHaveLength(2);
    expect(batches.map((batch) => batch.castShadow)).toEqual([false, true]);
    expect(batches[1].key).toContain('shadow:cast');
  });

  it('reuses instance buffers when instance ids and revisions match', () => {
    const cache = createDrawBatchCache();
    const first = cache.read([drawItem({ id: 'a', revision: 1 })]);
    const second = cache.read([drawItem({ id: 'a', revision: 1 })]);

    expect(second[0].instances).toBe(first[0].instances);
    expect(second[0].instancesChanged).toBe(false);
    expect(second[0].dirtyRanges).toEqual([]);
  });

  it('automatically batches matching draw items into one instanced draw', () => {
    const [batch] = createDrawBatchCache().read([
      drawItem({ id: 'component:cube:0' }),
      drawItem({ id: 'component:cube:1' }),
      drawItem({ id: 'inline:cube:2' })
    ]);

    expect(batch.instanceCount).toBe(3);
    expect(batch.instanceIds).toEqual(['component:cube:0', 'component:cube:1', 'inline:cube:2']);
  });

  it('emits dirty ranges when individual revisions change', () => {
    const cache = createDrawBatchCache();
    const first = cache.read([
      drawItem({ id: 'a', revision: 1 }),
      drawItem({ id: 'b', revision: 1 }),
      drawItem({ id: 'c', revision: 1 })
    ]);
    const second = cache.read([
      drawItem({ id: 'a', revision: 2 }),
      drawItem({ id: 'b', revision: 1 }),
      drawItem({ id: 'c', revision: 2 })
    ]);

    expect(second[0].instances).toBe(first[0].instances);
    expect(second[0].instancesChanged).toBe(true);
    expect(second[0].dirtyRanges).toEqual([
      { start: 0, count: 1 },
      { start: 2, count: 1 }
    ]);
  });

  it('orders batches deterministically by render plan keys', () => {
    const batches = createDrawBatchCache().read([
      drawItem({ id: 'z', pipelineKey: 'pipeline:z' }),
      drawItem({ id: 'a', renderOrder: -1 }),
      drawItem({ id: 'm', materialKey: 'material:a' })
    ]);

    expect(batches.map((batch) => batch.key)).toEqual([
      'pass:main|pipeline:standard:opaque|material:standard:white|bind:solid|box:1:1:1|order:-1',
      'pass:main|pipeline:standard:opaque|material:a|bind:solid|box:1:1:1|order:0',
      'pass:main|pipeline:z|material:standard:white|bind:solid|box:1:1:1|order:0'
    ]);
    expect(batches.map((batch) => batch.sortKey)).toEqual([0, 1, 2]);
  });
});

function drawItem({
  id,
  revision = 1,
  geometry = geometryData('box:1:1:1'),
  materialKey = 'material:standard:white',
  pipelineKey = 'pipeline:standard:opaque',
  bindGroupKey = 'bind:solid',
  renderOrder = 0,
  castShadow = false
}: {
  id: string;
  revision?: number;
  geometry?: TypeGpuGeometryData;
  materialKey?: string;
  pipelineKey?: string;
  bindGroupKey?: string;
  renderOrder?: number;
  castShadow?: boolean;
}): TypeGpuMeshDrawItem {
  return {
    id,
    node: createElement('mesh'),
    revision,
    geometry,
    material: material({ key: materialKey, pipelineKey, bindGroupKey }),
    transform: {
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: [1, 1, 1]
    },
    bounds: geometry.bounds!,
    color: [1, 1, 1, 1],
    renderOrder,
    hitTest: 'bounds',
    pointerEvents: 'auto',
    castShadow,
    receiveShadow: false
  };
}

function geometryData(key: string): TypeGpuGeometryData {
  return {
    key,
    kind: key.startsWith('sphere') ? 'sphere' : 'box',
    vertexData: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]),
    vertexCount: 1,
    vertexFloats: MESH_VERTEX_FLOATS,
    bounds: { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
    topology: 'triangle-list',
    layoutKey: MESH_VERTEX_LAYOUT_KEY
  };
}

function material({
  key,
  pipelineKey,
  bindGroupKey
}: {
  key: string;
  pipelineKey: string;
  bindGroupKey: string;
}): TypeGpuMaterialDescriptor {
  return {
    key,
    pipelineKey,
    bindGroupKey,
    kind: 'standard',
    color: [1, 1, 1, 1],
    roughness: 0.45,
    metalness: 0.05,
    opacity: 1,
    textureKey: 'solid:white',
    samplerKey: 'sampler:default',
    transparent: false,
    depthWrite: true,
    depthTest: true,
    cullMode: 'back',
    blendMode: 'opaque',
    map: null
  };
}
