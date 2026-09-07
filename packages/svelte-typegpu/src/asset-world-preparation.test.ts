// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, tick, unmount } from 'svelte';
import AssetWorld from '../../../apps/docs/src/examples/asset-world/AssetWorld.svelte';
import { prepareDistantWorldAssets } from '../../../apps/docs/src/examples/asset-world/distant-meshes';
import { lodWorldAssets } from '../../../apps/docs/src/examples/asset-world/model-detail';
import type { WorldAssets } from '../../../apps/docs/src/examples/asset-world/world';

const captured = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined,
  original: {} as WorldAssets, family: {} as WorldAssets }));
vi.mock('../../../apps/docs/node_modules/@lucide/svelte/dist/lucide-svelte.js', () => ({
  Map: () => {}, RotateCcw: () => {}, Tent: () => {}, UserRound: () => {}, Footprints: () => {},
  ArrowUp: () => {}, ArrowDown: () => {}, ArrowLeft: () => {}, ArrowRight: () => {} }));
vi.mock('../../../apps/docs/src/examples/asset-world/WorldViewport.typegpu.svelte', () => ({
  default: (_anchor: unknown, props: Record<string, unknown>) => { captured.props = props; }
}));
vi.mock('../../../apps/docs/src/examples/asset-world/world', async original => ({
  ...await original<typeof import('../../../apps/docs/src/examples/asset-world/world')>(),
  loadWorldAssets: vi.fn(async () => captured.original)
}));
vi.mock('../../../apps/docs/src/examples/asset-world/distant-meshes', () => ({ prepareDistantWorldAssets: vi.fn() }));
vi.mock('../../../apps/docs/src/examples/asset-world/model-detail', () => ({
  detailWorldAssets: vi.fn(() => captured.original), lodWorldAssets: vi.fn(() => captured.family)
}));
let instance: ReturnType<typeof mount> | undefined;
afterEach(async () => {
  if (instance) await unmount(instance);
  instance = undefined; captured.props = undefined; document.body.replaceChildren();
  vi.useRealTimers(); vi.clearAllMocks();
});
async function settle() { await tick(); await vi.runAllTimersAsync(); await tick(); }
function checkbox(name: string) {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    .find(input => input.parentElement!.textContent!.trim() === name)!;
}

describe('compiled asset-world asynchronous preparation', () => {
  it.each(['resolve', 'reject', 'unmount'] as const)('ignores stale distant preparation after %s', async outcome => {
    vi.useFakeTimers();
    let resolve!: (assets: WorldAssets) => void, reject!: (error: Error) => void;
    vi.mocked(prepareDistantWorldAssets).mockReturnValue(new Promise((yes, no) => { resolve = yes; reject = no; }));
    instance = mount(AssetWorld, { target: document.body });
    await settle(); expect(captured.props!.assets).toBe(captured.original);
    checkbox('LOD').click(); await settle();
    checkbox('Distant meshes').click(); await settle();
    expect(prepareDistantWorldAssets).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Preparing world');
    expect(captured.props!.assets).toBe(captured.family);
    if (outcome === 'unmount') { await unmount(instance); instance = undefined; }
    else { checkbox('Distant meshes').click(); await settle(); }
    vi.mocked(lodWorldAssets).mockClear();
    if (outcome === 'reject') reject(new Error('Stale failure'));
    else resolve({ ...captured.original });
    await settle();
    expect(lodWorldAssets).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it('keeps the active world on failure and reports an actionable error', async () => {
    vi.useFakeTimers();
    vi.mocked(prepareDistantWorldAssets).mockRejectedValue(new Error('Preparation failed'));
    instance = mount(AssetWorld, { target: document.body });
    await settle(); checkbox('LOD').click(); await settle();
    checkbox('Distant meshes').click(); await settle();
    expect(captured.props!.assets).toBe(captured.family);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Preparation failed');
    expect(document.querySelector('[role="status"]')).toBeNull();
  });
});
