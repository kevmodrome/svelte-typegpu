import { perlin3d } from '@typegpu/noise';
import tgpu, { d } from 'typegpu';
import { sceneBindGroupLayout } from 'svelte-typegpu';

const tanhVec = tgpu
  .fn([d.vec2f], d.vec2f)/* wgsl */ `(v) {
    let len = max(length(v), 0.0001);
    return v / len * tanh(len);
  }`
  .$name('smokyTriangleMeshTanhVec');

const gradientColor = tgpu
  .fn([d.f32, d.f32], d.vec3f)/* wgsl */ `(ratio, phase) {
    let fromColor = mix(vec3f(0.12, 0.18, 0.34), vec3f(0.28, 0.1, 0.3), phase);
    let toColor = mix(vec3f(1.35, 0.7, 1.8), vec3f(0.1, 1.2, 1.0), phase);
    return mix(fromColor, toColor, smoothstep(0.08, 0.92, ratio));
  }`
  .$name('smokyTriangleMeshGradientColor');

export const smokyTriangleMaterialFragment = tgpu
  .fragmentFn({
    in: {
      color: d.location(0, d.vec4f),
      normal: d.location(1, d.vec3f),
      material: d.location(2, d.vec4f),
      world_position: d.location(3, d.vec3f),
      uv: d.location(4, d.vec2f),
      vertex_color: d.location(5, d.vec4f),
      material_extra: d.location(6, d.vec4f)
    },
    out: d.vec4f
  })/* wgsl */ `{
    let time = sceneBindGroupLayout.$.scene.time * 0.08;
    let phase = fract(in.color.r);
    let seed = in.color.g * 19.0 + in.color.b * 31.0;
    let uv = in.uv + vec2f(seed * 0.037, seed * 0.023);
    let ouv = uv * 4.5 + vec2f(0.0, -time);
    var offset = vec2f(
      perlin3d.sample(vec3f(ouv, time)),
      perlin3d.sample(vec3f(ouv * 2.0, time + 10.0)) * 0.5
    ) - vec2f(0.1);
    offset = tanhVec(offset * 18.0);

    let samplePoint = in.uv + offset * 0.055;
    let factor = (samplePoint.x + samplePoint.y) * 0.7;
    let grainSeed = floor(sin(sceneBindGroupLayout.$.scene.time * 19.17 + seed) * 1000.0);
    let grain = perlin3d.sample(vec3f(uv * 160.0, grainSeed)) * 0.09;
    let color = gradientColor(factor, phase) + vec3f(grain);

    return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
  }`
  .$uses({ sceneBindGroupLayout, perlin3d, tanhVec, gradientColor })
  .$name('smokyTriangleMaterialFragment');
