import { readFileSync } from 'node:fs';
import tgpu, { d } from 'typegpu';
import { describe, expect, it } from 'vitest';
import {
  createShaderPassPipeline,
  meshFragmentMain,
  meshVertexMain,
  shadowVertexMain
} from './typegpu-pipeline';
import { shaderPassBindGroupLayout } from './typegpu-layouts';

describe('TypeGPU mesh pipeline shader functions', () => {
  const pipelineSource = readFileSync(new URL('./typegpu-pipeline.ts', import.meta.url), 'utf8');

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
    expect(wgsl).toContain('in.material_extra');
    expect(wgsl).toContain('color_transform');
    expect(wgsl).toContain('rotate_hue');

    const requiredLightingShaderSources = [
      'light_count',
      'light.kind',
      'in.world_position'
    ];
    const missingLightingShaderSources = requiredLightingShaderSources.filter(
      (source) => !wgsl.includes(source)
    );

    expect(missingLightingShaderSources).toEqual([]);
    expect(wgsl).toContain('if (light.kind == 1u)');
    expect(wgsl).toContain('else if (light.kind == 3u)');
    expect(wgsl).toContain('else if (light.kind == 4u || light.kind == 5u)');
    expect(wgsl).toContain('@group(2)');
    expect(wgsl).toContain('baseColorTexture');
    expect(wgsl).toContain('baseColorSampler');
    expect(wgsl).toContain('textureSample');
    expect(wgsl).toContain('textureSampleCompare');
    expect(wgsl).toContain('@group(3)');
    expect(wgsl).toContain('shadowMap');
    expect(wgsl).toContain('shadowSampler');
    expect(wgsl).toContain('receive_shadow');
    expect(wgsl).toContain('shadow_factor');
    expect(wgsl).not.toContain('var shadow =');
    expect(wgsl).toContain('in.uv');
    expect(wgsl).toContain('texel * in.color * in.vertex_color');
    expect(wgsl).toContain('shifted_color * 0.08');
    expect(wgsl).toContain('texel.a * in.color.a * in.vertex_color.a * in.material.z');
    expect(wgsl).toContain('specular_exponent');
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

  it('supports fullscreen shader pass fragments with built-in uniforms', () => {
    const fragment = tgpu
      .fragmentFn({
        in: { uv: d.vec2f },
        out: d.vec4f
      })/* wgsl */ `{
        let resolution = shaderPassBindGroupLayout.$.uniforms.resolution;
        let time = shaderPassBindGroupLayout.$.uniforms.time;
        return vec4f(in.uv.x, in.uv.y, fract(time + resolution.x * 0.0), 1.0);
      }`
      .$uses({ shaderPassBindGroupLayout })
      .$name('shaderPassFragmentFixture');

    const wgsl = tgpu.resolve([fragment], { names: 'strict' });

    expect(createShaderPassPipeline).toBeTypeOf('function');
    expect(wgsl).toContain('@fragment fn shaderPassFragmentFixture');
    expect(wgsl).toContain('@group(0)');
    expect(wgsl).toContain('var<uniform> uniforms');
    expect(wgsl).toContain('resolution');
    expect(wgsl).toContain('time');
    expect(pipelineSource).toContain('shaderPassVertexMain');
    expect(pipelineSource).toContain('vec2f(-1.0, 1.0)');
    expect(pipelineSource).toContain('vec2f(0.0, 1.0)');
  });
});
