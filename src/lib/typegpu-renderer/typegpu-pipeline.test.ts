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
    expect(wgsl).toContain('var spot_falloff = step(outer_cos, spot_cos);');
    expect(wgsl).toContain('if (penumbra > 0.0001)');
    expect(wgsl).toContain('spot_falloff = smoothstep(outer_cos, inner_cos, spot_cos);');
    expect(wgsl).toContain('@group(2)');
    expect(wgsl).toContain('baseColorTexture');
    expect(wgsl).toContain('baseColorSampler');
    expect(wgsl).toContain('textureSample');
    expect(wgsl).toContain('in.uv');
  });
});
