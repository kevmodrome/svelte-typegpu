// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { createFragment, dispatchNodeEvent, type TypeGpuNode } from './core';
import { compileViewportSource } from './viewport-test-utils';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';
import tgpu, { d } from 'typegpu';

describe('structured attributes backed by Svelte state', () => {
  it.each([
    { name: 'position', initial: '[0, 0, 0]', change: 'value[0] = 2', offset: 0, expected: 2 },
    { name: 'position', initial: '{ x: 0, y: 0, z: 0 }', change: 'value.x = 2', offset: 0, expected: 2 },
    { name: 'scale', initial: '{ x: 1, y: 1, z: 1 }', change: 'value.x = 2', offset: 8, expected: 2 },
    { name: 'rotation', initial: '{ x: 0, y: 0, z: 0 }', change: 'value.y = 0.7', offset: 14, expected: 0.7 },
    { name: 'quaternion', initial: '[0, 0, 0, 1]', change: 'value[1] = value[3] = Math.SQRT1_2', offset: 14, expected: Math.PI / 2 },
    { name: 'matrix', initial: '[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]', change: 'value[12] = 2', offset: 0, expected: 2 },
    { name: 'color', initial: '[1, 1, 1, 1]', change: 'value[0] = 0.2', offset: 4, expected: 0.2 }
  ].flatMap((test) => [false, true].map((spread) => ({ ...test, spread }))))(
    'updates mutable $name ($initial, spread: $spread)', async ({ name, initial, change, offset, expected, spread }) => {
    const { instance, gpu, dispose } = mountScene<{ move(): void; reset(): void }>(`
      <script>
        let value = $state(${initial});
        const properties = $state({ ${name}: value });
        export function move() { ${change}; }
        export function reset() { value = ${initial}; properties.${name} = value; }
      </script>
      <scene>
        <mesh><boxGeometry /></mesh>
        <mesh ${spread ? '{...properties}' : `${name}={value}`}><boxGeometry /></mesh>
      </scene>
    `);
    try {
      flushSync();
      await Promise.resolve();
      const before = vi.mocked(gpu.setScene).mock.lastCall![0];
      const instances = before.drawBatches[0].instances;
      vi.mocked(gpu.setScene).mockClear();
      flushSync(() => instance.move());
      await Promise.resolve();
      expect(gpu.setScene).toHaveBeenCalledOnce();
      const next = vi.mocked(gpu.setScene).mock.lastCall![0];
      expect(next.drawBatchesChanged).toBe(false);
      expect(next.drawBatches[0].instances).toBe(instances);
      expect(next.instanceUpdates![0].dirtyRanges).toEqual([{ start: 1, count: 1 }]);
      expect(instances[24 + offset]).toBeCloseTo(expected);
    } finally {
      await dispose();
    }
    vi.mocked(gpu.setScene).mockClear();
    flushSync(() => instance.reset());
    await Promise.resolve();
    expect(gpu.setScene).not.toHaveBeenCalled();
  });

  it.each(['uniforms={uniforms}', 'uniforms={{ value0: uniforms.value0 }}', '{...{ uniforms }}'])(
    'updates nested shader vectors through %s', async (attribute) => {
    const fragment = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })(() => d.vec4f(1));
    const { instance, gpu, dispose } = mountScene<{ change(): void }>(`
      <script>
        let { fragment } = $props();
        const uniforms = $state({ value0: [1, 0, 0, 1] });
        export function change() { uniforms.value0[0] = 0.25; }
      </script><scene><shaderPass {fragment} ${attribute} /></scene>
    `, { fragment });
    try {
      flushSync(); await Promise.resolve();
      const before = vi.mocked(gpu.setScene).mock.lastCall![0];
      const first = before.shaderPasses[0].uniforms;
      vi.mocked(gpu.setScene).mockClear();
      flushSync(() => instance.change()); await Promise.resolve();
      expect(gpu.setScene).toHaveBeenCalledOnce();
      const next = vi.mocked(gpu.setScene).mock.lastCall![0];
      expect(next.drawBatchesChanged).toBe(false);
      expect(next.shaderPasses[0].fragment).toBe(fragment);
      expect(next.shaderPasses[0].uniforms.value0).toEqual([0.25, 0, 0, 1]);
      expect(first.value0).toEqual([1, 0, 0, 1]);
    } finally { await dispose(); }
  });

  it('handles shorthand, replacement, deletion, snippets, dynamic elements and spread precedence', async () => {
    const { instance, gpu, dispose } = mountScene<{ change(): void; replace(): void; clear(): void }>(`
      <script>
        let position = $state([0, 0, 0]);
        let overrides = $state({ position: [1, 0, 0] });
        export function change() { overrides.position[0] = 2; }
        export function replace() { overrides = { position: [3, 0, 0] }; }
        export function clear() { delete overrides.position; position = [4, 0, 0]; }
      </script>
      {#snippet mesh()}
        <svelte:element this={'mesh'} {position} {...overrides}><boxGeometry /></svelte:element>
      {/snippet}
      <scene>{@render mesh()}</scene>
    `);
    try {
      flushSync(); await Promise.resolve();
      const read = () => vi.mocked(gpu.setScene).mock.lastCall![0].drawBatches[0].instances[0];
      expect(read()).toBe(1);
      for (const [method, expected] of [[instance.change, 2], [instance.replace, 3], [instance.clear, 4]] as const) {
        flushSync(method); await Promise.resolve();
        expect(read()).toBe(expected);
      }
    } finally { await dispose(); }
  });

  it('forwards component attachments and events without restarting them for deep prop updates', async () => {
    const Child = compileViewportSource(`<script>let props = $props();</script>
      <mesh {...props}><boxGeometry /></mesh>`);
    const cleanup = vi.fn(), setup = vi.fn((_node: TypeGpuNode) => cleanup), clicked = vi.fn();
    const { instance, gpu, dispose } = mountScene<{ move(): void }>(`
      <script>
        import Child from './Child.typegpu.svelte';
        let { setup, clicked } = $props();
        const position = $state([0, 0, 0]);
        export function move() { position[0]++; }
      </script>
      <scene><Child {position} {@attach setup} onclick={() => { clicked(); move(); }} /></scene>
    `, { setup, clicked }, { Child });
    let node: TypeGpuNode;
    try {
      flushSync(); await Promise.resolve();
      node = setup.mock.calls[0][0];
      for (let index = 1; index <= 3; index++) {
        flushSync(() => dispatchNodeEvent(node, 'click')); await Promise.resolve();
        expect(vi.mocked(gpu.setScene).mock.lastCall![0].drawBatches[0].instances[0]).toBe(index);
        expect(setup).toHaveBeenCalledOnce();
        expect(cleanup).not.toHaveBeenCalled();
        expect(clicked).toHaveBeenCalledTimes(index);
      }
    } finally { await dispose(); }
    expect(cleanup).toHaveBeenCalledOnce();
    vi.mocked(gpu.setScene).mockClear();
    flushSync(() => instance.move()); await Promise.resolve();
    expect(gpu.setScene).not.toHaveBeenCalled();
  });

  it('updates camera, light and clear-color records without repacking meshes', async () => {
    const { instance, gpu, dispose } = mountScene<{ change(): void }>(`
      <script>
        const position = $state({ x: 0, y: 0, z: 10 }), target = $state([0, 0, 0]);
        const clearColor = $state([0, 0, 0, 1]), skyColor = $state([1, 1, 1]);
        const groundColor = $state([0, 0, 0]);
        export function change() {
          position.x = 3; target[1] = 2; clearColor[0] = 0.25;
          skyColor[0] = 0.5; groundColor[2] = 0.75;
        }
      </script>
      <scene {clearColor}><perspectiveCamera active {position} {target} />
        <hemisphereLight {skyColor} {groundColor} /><mesh><boxGeometry /></mesh>
      </scene>
    `);
    try {
      flushSync(); await Promise.resolve();
      const first = vi.mocked(gpu.setScene).mock.lastCall![0];
      vi.mocked(gpu.setScene).mockClear();
      flushSync(() => instance.change()); await Promise.resolve();
      expect(gpu.setScene).toHaveBeenCalledOnce();
      const next = vi.mocked(gpu.setScene).mock.lastCall![0];
      expect(next.camera.position).toEqual([3, 0, 10]);
      expect(next.camera.target).toEqual([0, 2, 0]);
      expect(next.renderSettings.clearColor).toEqual([0.25, 0, 0, 1]);
      expect(next.lights[0]).toMatchObject({ color: [0.5, 1, 1], groundColor: [0, 0, 0.75] });
      expect(next.drawBatches).toBe(first.drawBatches);
      expect(next.drawBatchesChanged).toBe(false);
      expect(next.instanceUpdates ?? []).toHaveLength(0);
    } finally { await dispose(); }
  });

  it.each(['map', 'texture'])('updates bounds and %s descriptors while preserving opaque attribute inputs', async (name) => {
    const vertices = new Float32Array(36), data = new Uint8Array(16);
    let geometry: TypeGpuNode;
    const capture = (node: TypeGpuNode) => { geometry = node; };
    const { instance, gpu, dispose } = mountScene<{ change(): void }>(`
      <script>
        let { vertices, data, capture } = $props();
        const bounds = $state({ min: [-1, -1, -1], max: [1, 1, 1] });
        const map = $state({ kind: 'data', data, width: 2, height: 2 });
        const sampler = $state({ magFilter: 'nearest' });
        export function change() { bounds.max[0] = 2; map.width = 1; map.height = 4; sampler.magFilter = 'linear'; }
      </script><scene><mesh>
        <bufferGeometry {vertices} {bounds} {@attach capture} /><standardMaterial ${name}={map} {sampler} />
      </mesh></scene>
    `, { vertices, data, capture });
    try {
      flushSync(); await Promise.resolve();
      const first = vi.mocked(gpu.setScene).mock.lastCall![0].drawBatches[0];
      vi.mocked(gpu.setScene).mockClear();
      flushSync(() => instance.change()); await Promise.resolve();
      expect(gpu.setScene).toHaveBeenCalledOnce();
      const next = vi.mocked(gpu.setScene).mock.lastCall![0].drawBatches[0];
      expect(geometry!.attributes.vertices).toBe(vertices);
      expect(next.geometry.vertexData).toEqual(vertices);
      expect(next.geometry.bounds?.max).toEqual([2, 1, 1]);
      expect(first.geometry.bounds?.max).toEqual([1, 1, 1]);
      expect(next.material.texture?.kind).toBe('data');
      if (next.material.texture?.kind !== 'data') throw new Error('Missing data texture');
      expect(next.material.texture.data).toBe(data);
      expect(next.material.texture).toMatchObject({ width: 1, height: 4 });
      expect(next.material.sampler?.magFilter).toBe('linear');
      expect(next.material.textureKey).not.toBe(first.material.textureKey);
      expect(next.material.samplerKey).not.toBe(first.material.samplerKey);
    } finally { await dispose(); }
  });

  it('keeps texture descriptor identity stable when a sibling spread property changes', async () => {
    let material: TypeGpuNode;
    const capture = (node: TypeGpuNode) => { material = node; };
    const { instance, gpu, dispose } = mountScene<{ change(): void }>(`
      <script>
        let { capture } = $props();
        const appearance = $state({ map: { kind: 'url', src: '/texture.png' }, roughness: 0.5 });
        export function change() { appearance.roughness = 0.75; }
      </script><scene><mesh><boxGeometry /><standardMaterial {...appearance} {@attach capture} /></mesh></scene>
    `, { capture });
    try {
      flushSync(); await Promise.resolve();
      const snapshot = material!.attributes.map, revision = material!.revision;
      flushSync(() => instance.change()); await Promise.resolve();
      expect(material!.attributes.map).toBe(snapshot);
      expect(material!.revision).toBe(revision + 1);
      expect(vi.mocked(gpu.setScene).mock.lastCall![0].drawBatchesChanged).toBe(false);
    } finally { await dispose(); }
  });
});

function mountScene<Exports extends Record<string, unknown>>(source: string, props = {}, dependencies = {}) {
  const Scene = compileViewportSource<Exports>(source, dependencies);
  const root = createFragment();
  const gpu = {
    setOptions: vi.fn(),
    setScene: vi.fn(), setCamera: vi.fn(), invalidate: vi.fn(), renderFrame: vi.fn(),
    setFrameHandler: vi.fn(), getRenderSize: vi.fn(), dispose: vi.fn()
  } as TypeGpuRenderer;
  const runtime = createTypeGpuRuntimeForTest(root, new EventTarget() as HTMLCanvasElement, gpu);
  root.runtime = runtime;
  const instance = mount(Scene, { renderer, target: root, props });
  return { instance, gpu, async dispose() { await unmount(instance); runtime.dispose(); } };
}
