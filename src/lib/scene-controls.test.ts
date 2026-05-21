import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENE_CONTROLS,
  clampSceneControls,
  formatHueColor,
  nextHue
} from './scene-controls';

describe('scene controls', () => {
  it('normalizes interactive control values into safe renderer ranges', () => {
    expect(
      clampSceneControls({
        ...DEFAULT_SCENE_CONTROLS,
        spinSpeed: 4,
        cubeScale: -1,
        cubeCount: 20_000,
        hue: 725
      })
    ).toEqual({
      ...DEFAULT_SCENE_CONTROLS,
      spinSpeed: 2,
      cubeScale: 0.45,
      cubeCount: 10_000,
      hue: 5
    });
  });

  it('wraps hue changes and formats the material color', () => {
    expect(nextHue(330)).toBe(17);
    expect(formatHueColor(17)).toBe('hsl(17, 82%, 62%)');
  });
});
