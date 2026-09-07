// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import { prepareTypeGpuSource } from '../compiler';
import { createFragment, findFirst } from './core';
import renderer from './svelte-renderer';
import { createSceneState } from './scene-compiler';
import { compileViewportSource } from './viewport-test-utils';

describe('scene boolean attribute shorthand', () => {
  it.each(['castShadow receiveShadow', 'castShadow receiveShadow {...{}}', 'castShadow={true} receiveShadow={true}'])
    ('preserves boolean values for %s', async attributes => {
      const Scene = compileViewportSource(`<scene><mesh ${attributes}><boxGeometry /><standardMaterial /></mesh></scene>`);
      const root = createFragment(), instance = mount(Scene, { renderer, target: root });
      try {
        flushSync();
        const mesh = findFirst(root, node => node.name === 'mesh')!;
        expect(mesh.attributes.castShadow).toBe(true);
        expect(mesh.attributes.receiveShadow).toBe(true);
        expect(createSceneState(root).drawBatches[0].castShadow).toBe(true);
      } finally { await unmount(instance); }
    });

  it('preserves explicit strings, false expressions and native canvas shorthand', () => {
    const source = '<canvas hidden><scene><mesh castShadow="" receiveShadow={false} visible /></scene></canvas>';
    const prepared = prepareTypeGpuSource(source, 'Flags.typegpu.svelte');
    expect(prepared.code).toContain(' hidden>');
    expect(prepared.code).toContain('castShadow="" receiveShadow={false} visible={true}');
  });

  it('rewrites static scene-only flags without injecting an unused runtime helper', () => {
    const prepared = prepareTypeGpuSource('<mesh castShadow />', 'Flags.typegpu.svelte');
    expect(prepared.code).toBe('<mesh castShadow={true} />');
    expect(prepared.map).toBeDefined();
    expect(prepareTypeGpuSource('<mesh castShadow={true} />', 'Flags.typegpu.svelte').map).toBeUndefined();
  });
});
