import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compileViewportSource } from '../viewport-test-utils';
import * as world from '../../../../apps/docs/src/examples/asset-world/world';

export const worldComponentSource = (name: string) => readFileSync(resolve(
  process.cwd(), `../../apps/docs/src/examples/asset-world/${name}.typegpu.svelte`
), 'utf8');

export function compileWorldObjects() {
  const Tree = compileViewportSource(worldComponentSource('Tree'));
  const Rock = compileViewportSource(worldComponentSource('Rock'));
  const Log = compileViewportSource(worldComponentSource('Log'));
  const Tent = compileViewportSource(worldComponentSource('Tent'));
  const Campfire = compileViewportSource(worldComponentSource('Campfire'));
  const Bridge = compileViewportSource(worldComponentSource('Bridge'));
  const Sign = compileViewportSource(worldComponentSource('Sign'));
  const SelectionMarker = compileViewportSource(worldComponentSource('SelectionMarker'), world);
  return { Tree, Rock, Log, Tent, Campfire, Bridge, Sign, SelectionMarker };
}
