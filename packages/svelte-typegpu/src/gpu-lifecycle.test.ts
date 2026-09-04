import tgpu, { d } from 'typegpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, createFragment, insert, setAttribute } from './core';
import { Dirty } from './dirty';
import { createTypeGpuRenderer } from './gpu-renderer';
import {
  GeometryResourceCache,
  MaterialResourceCache,
  SamplerResourceCache,
  TextureResourceCache
} from './resource-caches';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';
import { createMaterialDescriptor } from './material-descriptors';
import { createMeshPipeline } from './typegpu-pipeline';

const captured = vi.hoisted(() => ({ bindings: [] as unknown[][] }));

vi.mock('typegpu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('typegpu')>();
  return { ...actual, default: { ...actual.default, init: vi.fn() } };
});

vi.mock('@typegpu/noise', () => ({
  perlin3d: { staticCache: () => ({ inject: () => (root: unknown) => root, destroy() {} }) }
}));
vi.mock('./typegpu-pipeline', () => {
  function pipeline(bindings: unknown[] = []) {
    return {
      with: (...values: unknown[]) => pipeline([...bindings, ...values]),
      withIndexBuffer: (...values: unknown[]) => pipeline([...bindings, ...values]),
      draw: () => captured.bindings.push(bindings),
      drawIndexed: () => captured.bindings.push(bindings)
    };
  }
  return {
    createMeshPipeline: vi.fn(() => pipeline()),
    createShadowPipeline: vi.fn(() => pipeline()),
    createShaderPassPipeline: vi.fn(() => pipeline())
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  captured.bindings.length = 0;
});

describe('GPU resource and frame lifecycle', () => {
  it('does not scan geometry resources on a camera-only scene update', async () => {
    const { renderer } = await setupRenderer();
    const tree = createFragment();
    const mesh = createElement('mesh');
    insert(mesh, createElement('boxGeometry'), null);
    insert(tree, mesh, null);
    const cache = createTypeGpuSceneCache();
    renderer.setScene(createSceneState(tree, cache));
    const lookup = vi.spyOn(GeometryResourceCache.prototype, 'getOrCreate');
    const prune = vi.spyOn(GeometryResourceCache.prototype, 'prune');

    renderer.setScene(createSceneState(tree, cache, { dirty: Dirty.Camera }));

    expect(lookup).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it('does not sort an unchanged render queue on every frame', async () => {
    const { renderer } = await setupRenderer();
    renderer.setScene(createSceneState(createFragment()));
    const sort = vi.spyOn(Array.prototype, 'sort');

    renderer.renderFrame(10);
    renderer.renderFrame(20);

    expect(sort).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it('refreshes depth-dependent pipelines even when draw batches are reused', async () => {
    const { renderer } = await setupRenderer();
    const tree = createElement('scene');
    const mesh = createElement('mesh');
    insert(mesh, createElement('boxGeometry'), null);
    insert(tree, mesh, null);
    const cache = createTypeGpuSceneCache();
    renderer.setScene(createSceneState(tree, cache));
    setAttribute(tree, 'depth', false);

    renderer.setScene(createSceneState(tree, cache, { dirty: Dirty.RenderSettings }));
    renderer.renderFrame(10);

    expect(vi.mocked(createMeshPipeline).mock.lastCall?.[2]?.depth).toBe(false);
    renderer.dispose();
  });

  it('keeps each shader pass uniform values distinct at GPU submission and frees removed buffers', async () => {
    const { renderer, buffers, submissions } = await setupRenderer();
    const tree = createFragment();
    const fragment = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })(() => d.vec4f(1));
    for (const color of [
      [1, 0, 0, 1],
      [0, 0, 1, 1]
    ]) {
      const pass = createElement('shaderPass');
      setAttribute(pass, 'fragment', fragment);
      setAttribute(pass, 'uniforms', { value0: color });
      insert(tree, pass, null);
    }
    renderer.setScene(createSceneState(tree));
    renderer.renderFrame(10);

    expect(submissions.at(-1)?.map((data) => Array.from(data.slice(4, 8)))).toEqual([
      [1, 0, 0, 1],
      [0, 0, 1, 1]
    ]);
    setAttribute(tree.firstChild!, 'uniforms', { value0: [0, 1, 0, 1] });
    setAttribute(tree.firstChild!, 'renderOrder', 1);
    renderer.setScene(createSceneState(tree));
    renderer.renderFrame(20);
    expect(submissions.at(-1)?.map((data) => Array.from(data.slice(4, 8)))).toEqual([
      [0, 0, 1, 1],
      [0, 1, 0, 1]
    ]);
    const passBuffers = buffers.filter((buffer) => buffer.label.includes('shader pass'));
    expect(passBuffers).toHaveLength(2);
    renderer.setScene(createSceneState(createFragment()));
    expect(passBuffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
    renderer.dispose();
  });

  it('destroys owned material uniform buffers when pruned or disposed', () => {
    const { root, buffers } = fakeRoot();
    const textures = new TextureResourceCache(root as never, () => {});
    const samplers = new SamplerResourceCache(root as never);
    const materials = new MaterialResourceCache(root as never, textures, samplers);
    materials.getOrCreate(createMaterialDescriptor('standard', {}));
    const first = buffers.at(-1)!;
    materials.prune(new Set());
    expect(first.destroy).toHaveBeenCalledOnce();
    materials.getOrCreate(createMaterialDescriptor('standard', {}));
    const second = buffers.at(-1)!;
    materials.dispose();
    expect(second.destroy).toHaveBeenCalledOnce();
    textures.dispose();
  });
});

async function setupRenderer() {
  const fake = fakeRoot();
  vi.mocked(tgpu.init).mockResolvedValue(fake.root as never);
  vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const renderer = await createTypeGpuRenderer({
    canvas: { clientWidth: 100, clientHeight: 100, width: 100, height: 100 } as HTMLCanvasElement,
    frameloop: 'manual'
  });
  return { ...fake, renderer };
}

function fakeBuffer() {
  return {
    label: '',
    buffer: {},
    data: new Float32Array(),
    $usage() {
      return this;
    },
    $name(label: string) {
      this.label = label;
      return this;
    },
    write: vi.fn(function (this: { data: Float32Array }, data: ArrayBuffer) {
      this.data = new Float32Array(data.slice(0));
    }),
    destroy: vi.fn()
  };
}

function fakeRoot() {
  const buffers: ReturnType<typeof fakeBuffer>[] = [];
  const submissions: Float32Array[][] = [];
  const root = {
    createBuffer: vi.fn(() => {
      const buffer = fakeBuffer();
      buffers.push(buffer);
      return buffer;
    }),
    createTexture: vi.fn(() => ({
      $usage() {
        return this;
      },
      $name() {
        return this;
      },
      write: vi.fn(),
      destroy: vi.fn(),
      createView: () => ({})
    })),
    createBindGroup: vi.fn((_layout: unknown, entries: unknown) => ({ entries })),
    createSampler: vi.fn(() => ({})),
    createComparisonSampler: vi.fn(() => ({})),
    configureContext: vi.fn(() => ({ getCurrentTexture: () => ({ createView: () => ({}) }) })),
    unwrap: (resource: unknown) => resource,
    pipe() {
      return this;
    },
    destroy: vi.fn(),
    device: {
      createCommandEncoder: () => ({ beginRenderPass: () => ({ end() {} }), finish: () => ({}) }),
      queue: {
        submit: () => {
          // Uniform writes take effect before submission, not separately for each draw call.
          submissions.push(
            captured.bindings.splice(0).map((bindings) => {
              const group = bindings.find((value: any) => value?.entries?.uniforms) as {
                entries: { uniforms: ReturnType<typeof fakeBuffer> };
              };
              return group?.entries.uniforms.data.slice() ?? new Float32Array();
            })
          );
        }
      }
    }
  };
  return { root, buffers, submissions };
}
