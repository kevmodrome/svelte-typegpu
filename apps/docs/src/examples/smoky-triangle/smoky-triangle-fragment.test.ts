import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createSmokyTriangleFragment, defaultSmokyTriangleControls } from './smoky-triangle-fragment';

describe('smoky triangle fragment controls', () => {
  it('creates distinct shader fragments from control values', () => {
    const base = createSmokyTriangleFragment(defaultSmokyTriangleControls);
    const fire = createSmokyTriangleFragment({
      ...defaultSmokyTriangleControls,
      distortion: 0.1,
      sharpness: 7,
      fromColor: [2, 0.4, 0.5],
      toColor: [0, 0, 0.4],
      polarCoords: true,
      squashed: false
    });

    expect(base).not.toBe(fire);
    expect(String(base)).toContain('smokyTriangleFragment');
    expect(String(fire)).toContain('smokyTriangleFragment');
  });

  it('preserves the original triangle silhouette inside the fullscreen shader pass', () => {
    const source = readFileSync(new URL('./smoky-triangle-fragment.ts', import.meta.url), 'utf8');

    expect(source).toContain('triangleMask');
    expect(source).toContain('discard');
    expect(source).toContain('vec2f(0.5, 0.92)');
    expect(source).toContain('vec2f(0.2, 0.08)');
    expect(source).toContain('vec2f(0.8, 0.08)');
  });

  it('uses the same Perlin noise primitive as the official TypeGPU shader', () => {
    const source = readFileSync(new URL('./smoky-triangle-fragment.ts', import.meta.url), 'utf8');

    expect(source).toContain("import { perlin3d } from '@typegpu/noise';");
    expect(source).toContain('perlin3d.sample(vec3f(ouv, time))');
    expect(source).toContain('perlin3d.sample(vec3f(in.uv * 200.0, grainSeed))');
    expect(source).not.toContain('const smokyNoise');
  });
});
