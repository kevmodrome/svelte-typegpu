import { perlin3d } from '@typegpu/noise';
import tgpu, { d } from 'typegpu';
import { shaderPassBindGroupLayout } from 'svelte-typegpu';

export interface SmokyTriangleControls {
  distortion: number;
  sharpness: number;
  fromColor: [number, number, number];
  toColor: [number, number, number];
  polarCoords: boolean;
  squashed: boolean;
}

export const defaultSmokyTriangleControls: SmokyTriangleControls = {
  distortion: 0.05,
  sharpness: 4.5,
  fromColor: [0.057, 0.2235, 0.4705],
  toColor: [1.538, 0.784, 2],
  polarCoords: false,
  squashed: true
};

const tanhVec = tgpu
  .fn([d.vec2f], d.vec2f)/* wgsl */ `(v) {
    let len = max(length(v), 0.0001);
    return v / len * tanh(len);
  }`
  .$name('smokyTanhVec');

export function createSmokyTriangleFragment(controls: SmokyTriangleControls) {
  const distortion = f32Literal(controls.distortion);
  const sharpness = f32Literal(controls.sharpness ** 2);
  const polarCoords = controls.polarCoords ? 'true' : 'false';
  const squashed = controls.squashed ? 'true' : 'false';

  const getGradientColor = tgpu
    .fn([d.f32], d.vec3f)/* wgsl */ `(ratio) {
      let uniforms = shaderPassBindGroupLayout.$.uniforms;
      let fromColor = uniforms.value0.rgb;
      let toColor = uniforms.value1.rgb;

      if (${squashed}) {
        return mix(fromColor, toColor, smoothstep(0.1, 0.9, ratio));
      }

      return mix(fromColor, toColor, ratio);
    }`
    .$uses({ shaderPassBindGroupLayout })
    .$name('smokyGradientColor');

  return tgpu
    .fragmentFn({
      in: { uv: d.vec2f },
      out: d.vec4f
    })/* wgsl */ `{
      let uniforms = shaderPassBindGroupLayout.$.uniforms;
      let top = vec2f(0.5, 0.92);
      let left = vec2f(0.2, 0.08);
      let right = vec2f(0.8, 0.08);
      let edgeA = left - top;
      let edgeB = right - left;
      let edgeC = top - right;
      let toA = in.uv - top;
      let toB = in.uv - left;
      let toC = in.uv - right;
      let triangleMask =
        step(0.0, edgeA.x * toA.y - edgeA.y * toA.x) *
        step(0.0, edgeB.x * toB.y - edgeB.y * toB.x) *
        step(0.0, edgeC.x * toC.y - edgeC.y * toC.x);

      if (triangleMask < 0.5) {
        discard;
      }

      let time = uniforms.time * 0.1;
      let ouv = in.uv * 5.0 + vec2f(0.0, -time);
      var offset = vec2f(
        perlin3d.sample(vec3f(ouv, time)),
        perlin3d.sample(vec3f(ouv * 2.0, time + 10.0)) * 0.5
      ) - vec2f(0.1);
      offset = tanhVec(offset * ${sharpness});
      let samplePoint = in.uv + offset * ${distortion};

      var factor = 0.0;
      if (${polarCoords}) {
        factor = length((samplePoint - vec2f(0.5, 0.3)) * 2.0);
      } else {
        factor = (samplePoint.x + samplePoint.y) * 0.7;
      }

      let grainSeed = floor(sin(uniforms.time * 19.17) * 1000.0);
      let grain = perlin3d.sample(vec3f(in.uv * 200.0, grainSeed)) * 0.1;
      let color = getGradientColor(factor) + vec3f(grain);

      return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)), 1.0);
    }`
    .$uses({ shaderPassBindGroupLayout, perlin3d, tanhVec, getGradientColor })
    .$name('smokyTriangleFragment');
}

export const smokyTriangleFragment = createSmokyTriangleFragment(defaultSmokyTriangleControls);

function f32Literal(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : '0.0';
}
