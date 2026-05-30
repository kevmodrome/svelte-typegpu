import tgpu, { d } from 'typegpu';
import { shaderPassBindGroupLayout } from 'svelte-typegpu';

function createDiscoFragment(name: string, layers: number, warpScale: number, spinSpeed: number, ringScale: number) {
  return tgpu
    .fragmentFn({
      in: { uv: d.vec2f },
      out: d.vec4f
    })/* wgsl */ `{
      let resolution = shaderPassBindGroupLayout.$.uniforms.resolution;
      let time = shaderPassBindGroupLayout.$.uniforms.time;
      let safeResolution = max(resolution, vec2f(1.0, 1.0));
      var uv = (in.uv - vec2f(0.5, 0.5)) * 2.0;
      let aspect = safeResolution.x / safeResolution.y;

      if (aspect > 1.0) {
        uv.x = uv.x * aspect;
      } else {
        uv.y = uv.y / max(aspect, 0.001);
      }

      var warped = uv;
      var color = vec3f(0.0, 0.0, 0.0);

      for (var iteration = 0; iteration < ${layers}; iteration = iteration + 1) {
        let layer = f32(iteration);
        let spin = time * (${spinSpeed} + layer * 0.035) + layer * 0.72;
        let rot = mat2x2f(cos(spin), -sin(spin), sin(spin), cos(spin));

        warped = rot * warped;
        warped = fract(warped * (${warpScale} + layer * 0.09)) - vec2f(0.5, 0.5);

        let originalRadius = length(uv);
        let radial = length(warped) * exp(-originalRadius * (1.35 + layer * 0.08));
        let pulse = abs(sin(radial * (7.0 + layer * 0.5) + time * (0.85 + layer * 0.06)));
        let ring = (${ringScale} + layer * 0.005) / (smoothstep(0.0, 0.12, pulse) + 0.015);
        let paletteT = originalRadius + time * 0.12 + layer * 0.08;
        let palette =
          vec3f(0.5, 0.59, 0.85) +
          vec3f(0.18, 0.42, 0.4) *
            cos(6.28318 * (vec3f(0.18, 0.48, 0.41) * paletteT + vec3f(0.35, 0.13, 0.32)));

        color = color + palette * ring;
      }

      return vec4f(color, 1.0);
    }`
    .$uses({ shaderPassBindGroupLayout })
    .$name(name);
}

export const discoFragment = tgpu
  .fragmentFn({
    in: { uv: d.vec2f },
    out: d.vec4f
  })/* wgsl */ `{
    let resolution = shaderPassBindGroupLayout.$.uniforms.resolution;
    let time = shaderPassBindGroupLayout.$.uniforms.time;
    let safeResolution = max(resolution, vec2f(1.0, 1.0));
    var uv = (in.uv - vec2f(0.5, 0.5)) * 2.0;
    let aspect = safeResolution.x / safeResolution.y;

    if (aspect > 1.0) {
      uv.x = uv.x * aspect;
    } else {
      uv.y = uv.y / max(aspect, 0.001);
    }

    var warped = uv;
    var color = vec3f(0.0, 0.0, 0.0);

    for (var iteration = 0; iteration < 5; iteration = iteration + 1) {
      let layer = f32(iteration);
      let spin = time * (0.2 + layer * 0.03) + layer * 0.7;
      let rot = mat2x2f(cos(spin), -sin(spin), sin(spin), cos(spin));

      warped = rot * warped;
      warped = fract(warped * (1.18 + layer * 0.08)) - vec2f(0.5, 0.5);

      let originalRadius = length(uv);
      let radial = length(warped) * exp(-originalRadius * (1.45 + layer * 0.06));
      let pulse = abs(sin(radial * (7.2 + layer * 0.45) + time * (0.9 + layer * 0.04)));
      let ring = (0.052 + layer * 0.004) / (smoothstep(0.0, 0.12, pulse) + 0.015);
      let paletteT = originalRadius + time * 0.12 + layer * 0.08;
      let palette =
        vec3f(0.5, 0.59, 0.85) +
        vec3f(0.18, 0.42, 0.4) *
          cos(6.28318 * (vec3f(0.18, 0.48, 0.41) * paletteT + vec3f(0.35, 0.13, 0.32)));

      color = color + palette * ring;
    }

    return vec4f(color, 1.0);
  }`
  .$uses({ shaderPassBindGroupLayout })
  .$name('discoFragment');

export const discoFragment1 = discoFragment;
export const discoFragment2 = createDiscoFragment('discoFragment2', 3, -0.9, 0.28, 0.1);
export const discoFragment3 = createDiscoFragment('discoFragment3', 4, 1.2, 0.3, 0.055);
export const discoFragment4 = createDiscoFragment('discoFragment4', 4, 1.25, 0.4, 0.058);
export const discoFragment5 = createDiscoFragment('discoFragment5', 3, -0.85, 1.5, 0.085);
export const discoFragment6 = createDiscoFragment('discoFragment6', 5, 1.3, 0.25, 0.05);
export const discoFragment7 = createDiscoFragment('discoFragment7', 4, 1.5, 0.35, 0.06);
