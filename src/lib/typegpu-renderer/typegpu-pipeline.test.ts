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

    const requiredLightingShaderSources = [
      'lightingBindGroupLayout',
      'evaluate_light',
      'evaluate_lighting',
      'in.world_position'
    ];
    const missingLightingShaderSources = requiredLightingShaderSources.filter(
      (source) => !wgsl.includes(source)
    );

    expect(missingLightingShaderSources).toEqual([]);
    expect(wgsl).toContain('select(');
    expect(wgsl).toContain('step(outer_cos, spot_cos)');
    expect(wgsl).toContain('penumbra > 0.0001');
  });
});
