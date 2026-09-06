import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import tgpu, { d } from 'typegpu';
import { perlin3d } from '@typegpu/noise';
import { createElement, createFragment, insert, setAttribute } from './core';
import { createSceneState } from './scene-compiler';
import { PipelineResourceCache } from './resource-caches';
import { createMeshPipeline } from './typegpu-pipeline';
import { smokyTriangleMaterialFragment } from '../../../apps/docs/src/examples/multiple-smoky-triangles/smoky-triangle-material';

const flatFragment = tgpu.fragmentFn({ in: smokyTriangleMaterialFragment.shell.in!, out: d.vec4f })
  `{ return vec4f(0.2, 0.4, 0.6, 1.0); }`;
const otherNoiseFragment = tgpu.fragmentFn({ in: smokyTriangleMaterialFragment.shell.in!, out: d.vec4f })
  `{ return vec4f(vec3f(perlin3d.sample(vec3f(in.uv, 1.0))), 1.0); }`.$uses({ perlin3d });

function batch(fragment?: typeof smokyTriangleMaterialFragment | typeof flatFragment) {
  const root = createFragment(), mesh = createElement('mesh');
  insert(root, mesh, null);
  insert(mesh, createElement('boxGeometry'), null);
  const material = createElement(fragment ? 'shaderMaterial' : 'standardMaterial');
  if (fragment) setAttribute(material, 'fragment', fragment);
  insert(mesh, material, null);
  const result = createSceneState(root).drawBatches[0];
  expect(result.material.kind).toBe(fragment ? 'shader' : 'standard');
  return result;
}

// Only the native device is recorded: TypeGPU and @typegpu/noise resolve real shaders.
function deviceRecorder() {
  const computePass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn() };
  const device = {
    features: new Set(),
    limits: { minUniformBufferOffsetAlignment: 256, minStorageBufferOffsetAlignment: 256 },
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => ({
      ...descriptor, mapState: 'unmapped', destroy: vi.fn()
    })),
    createShaderModule: vi.fn((descriptor: GPUShaderModuleDescriptor) => descriptor),
    createBindGroupLayout: vi.fn((descriptor: GPUBindGroupLayoutDescriptor) => descriptor),
    createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => descriptor),
    createPipelineLayout: vi.fn((descriptor: GPUPipelineLayoutDescriptor) => descriptor),
    createRenderPipeline: vi.fn((descriptor: GPURenderPipelineDescriptor) => descriptor),
    createComputePipeline: vi.fn((descriptor: GPUComputePipelineDescriptor) => descriptor),
    createCommandEncoder: vi.fn(() => ({ beginComputePass: () => computePass, finish: () => ({}) })),
    queue: { writeBuffer: vi.fn(), submit: vi.fn() },
    destroy: vi.fn()
  };
  const root = tgpu.initFromDevice({ device: device as unknown as GPUDevice, unstable_names: 'strict' });
  const cache = new PipelineResourceCache(root, 'rgba8unorm');
  return { root, cache, device, computePass };
}

beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8,
    INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 });
  vi.stubGlobal('GPUShaderStage', { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 });
});
afterEach(() => vi.unstubAllGlobals());

describe('lazy mesh shader resources', () => {
  it.each([undefined, flatFragment])('does not initialize noise for an unused or non-noise shader (%s)', fragment => {
    const { root, cache, device } = deviceRecorder();
    try {
      expect(device.createBuffer).not.toHaveBeenCalled();
      const pipeline = cache.getOrCreate(batch(fragment));
      expect(device.createBuffer).not.toHaveBeenCalled();
      root.unwrap(pipeline);
      expect(device.createRenderPipeline).toHaveBeenCalledOnce();
      expect(device.createBuffer).not.toHaveBeenCalled();
      expect(device.createComputePipeline).not.toHaveBeenCalled();
      expect(device.queue.submit).not.toHaveBeenCalled();
    } finally { cache.dispose(); root.destroy(); }
  });

  it('respects a shader-local noise implementation without creating the renderer cache', () => {
    const { root, cache, device } = deviceRecorder();
    const sample = perlin3d.sample.with(perlin3d.getJunctionGradientSlot, perlin3d.computeJunctionGradient);
    const fragment = tgpu.fragmentFn({ in: smokyTriangleMaterialFragment.shell.in!, out: d.vec4f })
      `{ return vec4f(vec3f(sample(vec3f(in.uv, 1.0))), 1.0); }`.$uses({ sample });
    try {
      cache.getOrCreate(batch(fragment));
      expect(device.createRenderPipeline).toHaveBeenCalledOnce();
      expect(device.createBuffer).not.toHaveBeenCalled();
      expect(device.createComputePipeline).not.toHaveBeenCalled();
    } finally { cache.dispose(); root.destroy(); }
  });

  it('initializes once on actual shader resolution and reuses across variants and pruning', () => {
    const { root, cache, device, computePass } = deviceRecorder();
    try {
      const noisy = batch(smokyTriangleMaterialFragment);
      expect(device.createBuffer).not.toHaveBeenCalled();
      const pipeline = cache.getOrCreate(noisy);
      root.unwrap(pipeline);
      expect(device.createBuffer.mock.calls.map(([value]) => value.size).sort((a, b) => a - b)).toEqual([12, 524288]);
      expect(device.createComputePipeline).toHaveBeenCalledOnce();
      expect(computePass.dispatchWorkgroups).toHaveBeenCalledOnce();
      expect(computePass.dispatchWorkgroups).toHaveBeenCalledWith(4, 4, 8);
      expect(device.queue.submit).toHaveBeenCalledOnce();
      const groups = device.createBindGroup.mock.calls.length;
      expect(cache.getOrCreate(noisy)).toBe(pipeline);
      for (let i = 0; i < 10; i++) root.unwrap(pipeline);
      root.unwrap(cache.getOrCreate(noisy, false));
      root.unwrap(cache.getOrCreate(batch(otherNoiseFragment)));
      cache.prune(new Set());
      expect(cache.getOrCreate(noisy)).not.toBe(pipeline);
      root.unwrap(cache.getOrCreate(noisy));
      expect(device.createRenderPipeline).toHaveBeenCalledTimes(4);
      expect(device.createBuffer).toHaveBeenCalledTimes(2);
      expect(device.createBindGroup).toHaveBeenCalledTimes(groups);
      expect(device.createComputePipeline).toHaveBeenCalledOnce();
      expect(device.queue.submit).toHaveBeenCalledOnce();
      const storage = device.createBuffer.mock.results.find(result => result.value.size === 524288)!.value;
      expect(storage.destroy).not.toHaveBeenCalled();
      cache.dispose(); cache.dispose();
      expect(storage.destroy).toHaveBeenCalledOnce();
      expect(() => cache.getOrCreate(noisy)).toThrow(/disposed/i);
    } finally { cache.dispose(); root.destroy(); }
  });

  it('does not share automatically initialized resources between roots', () => {
    const first = deviceRecorder(), second = deviceRecorder();
    try {
      first.cache.getOrCreate(batch(smokyTriangleMaterialFragment));
      expect(second.device.createBuffer).not.toHaveBeenCalled();
      second.cache.getOrCreate(batch(smokyTriangleMaterialFragment));
      expect(first.device.createBuffer).toHaveBeenCalledTimes(2);
      expect(second.device.createBuffer).toHaveBeenCalledTimes(2);
      first.cache.dispose();
      for (const result of second.device.createBuffer.mock.results) expect(result.value.destroy).not.toHaveBeenCalled();
      second.cache.getOrCreate(batch(otherNoiseFragment));
      expect(second.device.queue.submit).toHaveBeenCalledOnce();
    } finally { first.cache.dispose(); first.root.destroy(); second.cache.dispose(); second.root.destroy(); }
  });

  it('retains initialized noise after an unrelated shader error without hiding the error', () => {
    const { root, cache, device } = deviceRecorder();
    try {
      const missing = tgpu.slot<number>();
      const broken = tgpu.fragmentFn({ in: smokyTriangleMaterialFragment.shell.in!, out: d.vec4f })
        `{ return vec4f(perlin3d.sample(vec3f(in.uv, 1.0)) + missing); }`.$uses({ perlin3d, missing });
      expect(() => cache.getOrCreate(batch(broken))).toThrow(/Missing value/);
      expect(device.createComputePipeline).toHaveBeenCalledOnce();
      expect(device.createRenderPipeline).not.toHaveBeenCalled();
      cache.getOrCreate(batch(smokyTriangleMaterialFragment));
      expect(device.createComputePipeline).toHaveBeenCalledOnce();
      expect(device.createRenderPipeline).toHaveBeenCalledOnce();
    } finally { cache.dispose(); root.destroy(); }
  });

  it('preserves the eagerly injected noise shader exactly and isolates roots', () => {
    const first = deviceRecorder(), second = deviceRecorder();
    try {
      const eager = perlin3d.staticCache({ root: second.root, size: d.vec3u(32, 32, 32) });
      try {
        first.root.unwrap(first.cache.getOrCreate(batch(smokyTriangleMaterialFragment)));
        second.root.unwrap(createMeshPipeline(second.root.pipe(eager.inject()), 'rgba8unorm', {
          fragment: smokyTriangleMaterialFragment
        }));
        expect(first.device.createShaderModule.mock.calls.map(([value]) => value.code))
          .toEqual(second.device.createShaderModule.mock.calls.map(([value]) => value.code));
        const firstStorage = first.device.createBuffer.mock.results.find(result => result.value.size === 524288)!.value;
        const secondStorage = second.device.createBuffer.mock.results.find(result => result.value.size === 524288)!.value;
        expect(firstStorage).not.toBe(secondStorage);
        first.cache.dispose();
        expect(firstStorage.destroy).toHaveBeenCalledOnce();
        expect(secondStorage.destroy).not.toHaveBeenCalled();
      } finally { eager.destroy(); }
    } finally { first.cache.dispose(); first.root.destroy(); second.cache.dispose(); second.root.destroy(); }
  });

  it('does not allocate noise after disposal or for an unrelated shader resolution failure', () => {
    const { root, cache, device } = deviceRecorder();
    try {
      const missing = tgpu.slot<number>();
      const broken = tgpu.fragmentFn({ in: smokyTriangleMaterialFragment.shell.in!, out: d.vec4f })
        `{ return vec4f(missing); }`.$uses({ missing });
      expect(() => cache.getOrCreate(batch(broken))).toThrow(/Missing value/);
      expect(device.createBuffer).not.toHaveBeenCalled();
      expect(device.createRenderPipeline).not.toHaveBeenCalled();
      cache.dispose();
      expect(() => cache.getOrCreate(batch(smokyTriangleMaterialFragment))).toThrow(/disposed/i);
      expect(device.createBuffer).not.toHaveBeenCalled();
      expect(device.queue.submit).not.toHaveBeenCalled();
    } finally { root.destroy(); }
  });
});
