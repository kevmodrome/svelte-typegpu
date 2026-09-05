// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte';
import { expect, it, vi } from 'vitest';
import { compileAsyncTypeGpuSource } from '../src/component-test-utils';
import { createFragment } from '../src/core';
import renderer from '../src/svelte-renderer';

it.each(['resolve', 'reject'] as const)(
  'settles a pending async boundary after unmount (%s)',
  async (outcome) => {
    const Scene = await compileAsyncTypeGpuSource(`
      <script>let { request, setup } = $props();</script>
      {#snippet pending()}<mesh name="pending" />{/snippet}
      {#snippet failed(error)}<mesh name="failed" />{/snippet}
      <svelte:boundary {pending} {failed}>
        <mesh name={await request} {@attach setup} />
      </svelte:boundary>
    `);
    let resolve!: (value: string) => void;
    let reject!: (error: unknown) => void;
    const request = new Promise<string>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const root = createFragment();
    const setup = vi.fn();
    const scheduleSync = vi.fn();
    root.runtime = { scheduleSync };
    const instance = mount(Scene, { renderer, target: root, props: { request, setup } });
    await tick();
    await unmount(instance);
    scheduleSync.mockClear();
    if (outcome === 'resolve') resolve('late');
    else reject(new Error('late'));
    await tick();
    expect(root.children).toEqual([]);
    expect(setup).not.toHaveBeenCalled();
    expect(scheduleSync).not.toHaveBeenCalled();
  }
);
