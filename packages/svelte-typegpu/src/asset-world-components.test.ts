// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { createFragment, dispatchNodeEvent, findFirst, type TypeGpuNode } from './core';
import renderer from './svelte-renderer';
import { createSceneState } from './scene-compiler';
import { compileViewportSource } from './viewport-test-utils';
import { loadGlbModel } from './glb-loader';
import { compileWorldObjects, worldComponentSource } from './test-fixtures/asset-world-components';
import * as world from '../../../apps/docs/src/examples/asset-world/world';
import { createLandscape } from '../../../apps/docs/src/examples/asset-world/landscape';

const assets = Object.fromEntries(Object.entries(world.assetFiles).map(([key, file]) => {
  const bytes = readFileSync(resolve(process.cwd(), `../../apps/docs/public/assets/asset-world/${file}`));
  return [key, loadGlbModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), file)];
})) as world.WorldAssets;

function workload(root: TypeGpuNode) {
  return createSceneState(root).drawBatches.map(batch => ({
    geometry: batch.geometry, material: batch.material, count: batch.instanceCount,
    instances: Array.from(batch.instances), castShadow: batch.castShadow
  }));
}

describe('asset-world object components', () => {
  it.each([
    ['Tree', 'pine'], ['Rock', 'rock'], ['Log', 'log'], ['Tent', 'tent'],
    ['Campfire', 'firepit'], ['Bridge', 'bridge'], ['Sign', 'sign']
  ] as const)('%s forwards reactive placement and clicks without extra scene nodes', async (component, asset) => {
    const objects = compileWorldObjects(), click = vi.fn(), nextClick = vi.fn();
    const Host = compileViewportSource<{ update(values: Record<string, unknown>): void }>(`<script>
      let { Object, assets, click } = $props();
      let props = $state({ name: 'subject', position: [1, 2, 3], scale: 2, onclick: click });
      export function update(values) { props = { ...props, ...values }; }
    </script><scene><Object {assets} {...props} /></scene>`);
    const root = createFragment();
    const instance = mount(Host, { renderer, target: root, props: { Object: objects[component], assets, click } });
    try {
      flushSync();
      const model = findFirst(root, node => node.name === 'model')!;
      expect(model.parent?.name).toBe('scene');
      expect(model.attributes.asset).toBe(assets[asset]);
      expect(model.attributes).not.toHaveProperty('assets');
      expect(model.attributes).not.toHaveProperty('kind');
      expect(model.attributes.castShadow).toBe(true);
      dispatchNodeEvent(model, 'click'); expect(click).toHaveBeenCalledOnce();
      flushSync(() => instance.update({ position: [4, 5, 6], scale: [1, 2, 3], rotation: [0, 1, 0],
        onclick: nextClick, castShadow: false, receiveShadow: false, ...(component === 'Tree' ? { kind: 'oak' } : {}) }));
      expect(findFirst(root, node => node.name === 'model')).toBe(model);
      expect(model.attributes.position).toEqual([4, 5, 6]);
      expect(model.attributes.scale).toEqual([1, 2, 3]);
      expect(model.attributes.rotation).toEqual([0, 1, 0]);
      expect(model.attributes.castShadow).toBe(false);
      expect(model.attributes.receiveShadow).toBe(false);
      expect(model.attributes.asset).toBe(assets[component === 'Tree' ? 'oak' : asset]);
      dispatchNodeEvent(model, 'click'); expect(nextClick).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce();
      flushSync(() => instance.update({ visible: false, pointerEvents: 'none' }));
      expect(createSceneState(root).drawBatches).toHaveLength(0);
      expect(createSceneState(root).interaction.targets).toHaveLength(0);
    } finally { await unmount(instance); }
  });

  it('preserves inline landscape batching across forest toggles, keyed reorder and removal', async () => {
    const Landscape = compileViewportSource(worldComponentSource('Landscape'), compileWorldObjects());
    const Inline = compileViewportSource(`<script>let { assets, landscape, forest = true } = $props();</script>
      {#each landscape.placements as item (item.key)}
        <model asset={assets[item.asset]} position={item.position} scale={item.scale} rotation={item.rotation}
          visible={forest || (item.asset !== 'pine' && item.asset !== 'oak')} pointerEvents="none" castShadow receiveShadow />
      {/each}`);
    const Host = compileViewportSource<{ setForest(value: boolean): void; layout(value: unknown): void }>(`<script>
      let { Scene, assets, initial } = $props(); let landscape = $state.raw(initial), forest = $state(true);
      export function setForest(value) { forest = value; }
      export function layout(value) { landscape = value; }
    </script><scene><Scene {assets} {landscape} {forest} /></scene>`);
    const layout = createLandscape(1000), roots = [createFragment(), createFragment()];
    const instances = [Landscape, Inline].map((Scene, index) => mount(Host, {
      renderer, target: roots[index], props: { Scene, assets, initial: layout }
    }));
    try {
      flushSync();
      const first = findFirst(roots[0], node => node.name === 'model')!;
      const same = () => {
        expect(workload(roots[0])).toEqual(workload(roots[1]));
        expect(createSceneState(roots[0]).interaction.targets).toHaveLength(0);
      };
      same();
      for (const value of [false, true]) { flushSync(() => instances.forEach(instance => instance.setForest(value))); same(); }
      const reordered = { ...layout, placements: [...layout.placements].reverse() };
      flushSync(() => instances.forEach(instance => instance.layout(reordered))); same();
      expect(findFirst(roots[0], node => node === first)).toBe(first);
      const removed = { ...layout, placements: reordered.placements.slice(0, -1) };
      flushSync(() => instances.forEach(instance => instance.layout(removed))); same();
      expect(findFirst(roots[0], node => node === first)).toBeNull();
    } finally { for (const instance of instances) await unmount(instance); }
  });
});
