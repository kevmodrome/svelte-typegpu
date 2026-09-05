import tgpu, { d } from 'typegpu';
import { materialBindGroupLayout } from 'svelte-typegpu';

export const markerFragment = tgpu.fragmentFn({
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
}) /* wgsl */ `{
  let amount = materialBindGroupLayout.$.uniforms.value0.x;
  let color = mix(vec3f(0.88, 0.92, 0.95), vec3f(0.25, 0.9, 0.65), amount);
  let stripes = 0.75 + 0.25 * sin(in.uv.y * (12.0 + amount * 30.0));
  return vec4f(color * stripes, 1.0);
}`
  .$uses({ materialBindGroupLayout })
  .$name('motionMarkerFragment');
