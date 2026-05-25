import tgpu from 'typegpu';
import { describe, expect, it } from 'vitest';
import { meshFragmentMain, meshVertexMain, shadowVertexMain } from './typegpu-pipeline';

describe('TypeGPU mesh pipeline shader functions', () => {
  it('resolves the vertex shader with vertex colors passed to varyings', () => {
    const wgsl = tgpu.resolve([meshVertexMain], { names: 'strict' });

    expect(wgsl).toContain('vertex_color');
    expect(wgsl).toContain('output.vertex_color = vertex_color;');
  });

  it('resolves the fragment shader with varying inputs attached', () => {
    const wgsl = tgpu.resolve([meshFragmentMain], { names: 'strict' });

    expect(wgsl).toContain('@fragment fn meshFragmentMain(in:');
    expect(wgsl).toContain('in.color');
    expect(wgsl).toContain('in.vertex_color');
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
    expect(wgsl).toContain('textureSampleCompare');
    expect(wgsl).toContain('in.uv');
    expect(wgsl).toContain('texel * in.color * in.vertex_color');
    expect(wgsl).toContain('receive_shadow');
    expect(wgsl).toContain('shadowBindGroupLayout');
    expect(wgsl).toContain('texel.a * in.color.a * in.vertex_color.a * in.material.z');
  });

  it('resolves the depth-only shadow vertex shader with the shadow matrix bind group', () => {
    const wgsl = tgpu.resolve([shadowVertexMain], { names: 'strict' });

    expect(wgsl).toContain('@vertex fn shadowVertexMain');
    expect(wgsl).toContain('@group(1)');
    expect(wgsl).toContain('var<uniform> shadow');
    expect(wgsl).toContain('view_projection');
    expect(wgsl).toContain('@group(0)');
    expect(wgsl).toContain('var<uniform> scene');
    expect(wgsl).not.toContain('@group(3)');
    expect(wgsl).not.toContain('texture_depth_2d');
    expect(wgsl).not.toContain('sampler_comparison');
    expect(wgsl).not.toContain('shadowMap');
    expect(wgsl).not.toContain('@fragment');
  });
});
