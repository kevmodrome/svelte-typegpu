import tgpu from 'typegpu';
import { describe, expect, it } from 'vitest';
import { meshFragmentMain } from './typegpu-pipeline';

describe('TypeGPU mesh pipeline shader functions', () => {
  it('resolves the fragment shader with varying inputs attached', () => {
    const wgsl = tgpu.resolve([meshFragmentMain], { names: 'strict' });

    expect(wgsl).toContain('@fragment fn meshFragmentMain(in:');
    expect(wgsl).toContain('in.color');
    expect(wgsl).toContain('in.normal');
    expect(wgsl).toContain('in.material');
    expect(wgsl).toContain('color_transform');
    expect(wgsl).toContain('rotate_hue');
    expect(wgsl).toContain('@group(1)');
    expect(wgsl).toContain('baseColorTexture');
    expect(wgsl).toContain('baseColorSampler');
    expect(wgsl).toContain('textureSample');
    expect(wgsl).toContain('in.uv');
  });
});
