import tgpu, { d, type TgpuRenderPipeline, type TgpuRoot } from 'typegpu';
import { DEPTH_FORMAT } from './render-constants';
import {
  materialBindGroupLayout,
  meshInstanceLayout,
  meshVertexLayout,
  sceneBindGroupLayout
} from './typegpu-layouts';

const rotateX = tgpu
  .fn([d.vec3f, d.f32], d.vec3f)/* wgsl */ `(position, angle) {
    let c = cos(angle);
    let s = sin(angle);
    return vec3(position.x, position.y * c - position.z * s, position.y * s + position.z * c);
  }`
  .$name('rotateX');

const rotateY = tgpu
  .fn([d.vec3f, d.f32], d.vec3f)/* wgsl */ `(position, angle) {
    let c = cos(angle);
    let s = sin(angle);
    return vec3(position.x * c + position.z * s, position.y, -position.x * s + position.z * c);
  }`
  .$name('rotateY');

const rotateZ = tgpu
  .fn([d.vec3f, d.f32], d.vec3f)/* wgsl */ `(position, angle) {
    let c = cos(angle);
    let s = sin(angle);
    return vec3(position.x * c - position.y * s, position.x * s + position.y * c, position.z);
  }`
  .$name('rotateZ');

const rotateHue = tgpu
  .fn([d.vec3f, d.f32], d.vec3f)/* wgsl */ `(color, angle) {
    let c = cos(angle);
    let s = sin(angle);
    let shifted = vec3(
      color.r * (0.213 + c * 0.787 - s * 0.213) +
        color.g * (0.715 - c * 0.715 - s * 0.715) +
        color.b * (0.072 - c * 0.072 + s * 0.928),
      color.r * (0.213 - c * 0.213 + s * 0.143) +
        color.g * (0.715 + c * 0.285 + s * 0.140) +
        color.b * (0.072 - c * 0.072 - s * 0.283),
      color.r * (0.213 - c * 0.213 - s * 0.787) +
        color.g * (0.715 - c * 0.715 + s * 0.715) +
        color.b * (0.072 + c * 0.928 + s * 0.072)
    );

    return clamp(shifted, vec3(0.0), vec3(1.0));
  }`
  .$name('rotate_hue');

const meshVertexMain = tgpu
  .vertexFn({
    in: {
      position: d.vec3f,
      normal: d.vec3f,
      uv: d.vec2f,
      instance_position: d.vec3f,
      phase: d.f32,
      color: d.vec4f,
      shape: d.vec4f,
      spin_offset: d.f32,
      world_rotation: d.vec3f,
      material: d.vec4f
    },
    out: {
      position: d.builtin.position,
      color: d.location(0, d.vec4f),
      normal: d.location(1, d.vec3f),
      material: d.location(2, d.vec4f),
      uv: d.location(3, d.vec2f)
    }
  })/* wgsl */ `{
    let spin = (
      sceneBindGroupLayout.$.scene.time * sceneBindGroupLayout.$.scene.animation_speed +
      sceneBindGroupLayout.$.scene.animation_offset
    ) * shape.w + spin_offset;
    let pulse = 0.9 + sin(spin + phase) * 0.05;
    let spin_y = spin + phase;
    let spin_x = spin * 0.65 + phase * 0.35;
    let local_position = position * shape.xyz * sceneBindGroupLayout.$.scene.scale * pulse;
    let animated_position = rotate_x(rotate_y(local_position, spin_y), spin_x);
    let animated_normal = normalize(rotate_x(rotate_y(normal, spin_y), spin_x));
    let rotated_position = rotate_z(
      rotate_y(rotate_x(animated_position, world_rotation.x), world_rotation.y),
      world_rotation.z
    );
    let rotated_normal = normalize(rotate_z(
      rotate_y(rotate_x(animated_normal, world_rotation.x), world_rotation.y),
      world_rotation.z
    ));
    let world_position = rotated_position + instance_position;
    var output: Out;

    output.position = sceneBindGroupLayout.$.scene.view_projection * vec4(world_position, 1.0);
    output.color = color;
    output.normal = rotated_normal;
    output.material = material;
    output.uv = uv;

    return output;
  }`
  .$uses({ rotate_x: rotateX, rotate_y: rotateY, rotate_z: rotateZ, sceneBindGroupLayout })
  .$name('meshVertexMain');

export const meshFragmentMain = tgpu
  .fragmentFn({
    in: {
      color: d.location(0, d.vec4f),
      normal: d.location(1, d.vec3f),
      material: d.location(2, d.vec4f),
      uv: d.location(3, d.vec2f)
    },
    out: d.vec4f
  })/* wgsl */ `{
    let roughness = clamp(in.material.x, 0.0, 1.0);
    let metalness = clamp(in.material.y, 0.0, 1.0);
    let light = normalize(vec3(0.45, 0.78, 0.6));
    let diffuse = max(dot(normalize(in.normal), light), 0.0);
    let shade = 0.24 + diffuse * mix(0.78, 0.58, roughness);
    let lift = metalness * 0.08;
    let texel = textureSample(
      materialBindGroupLayout.$.baseColorTexture,
      materialBindGroupLayout.$.baseColorSampler,
      in.uv
    );
    let shifted_color = rotate_hue(
      (texel * in.color).rgb,
      sceneBindGroupLayout.$.scene.color_transform.x
    );

    return vec4(shifted_color * shade + lift, texel.a * in.color.a * in.material.z);
  }`
  .$uses({ rotate_hue: rotateHue, sceneBindGroupLayout, materialBindGroupLayout })
  .$name('meshFragmentMain');

export function createMeshPipeline(root: TgpuRoot, format: GPUTextureFormat): TgpuRenderPipeline<d.v4f> {
  return root
    .createRenderPipeline({
      attribs: {
        position: meshVertexLayout.attrib.position,
        normal: meshVertexLayout.attrib.normal,
        uv: meshVertexLayout.attrib.uv,
        instance_position: meshInstanceLayout.attrib.position,
        phase: meshInstanceLayout.attrib.phase,
        color: meshInstanceLayout.attrib.color,
        shape: meshInstanceLayout.attrib.shape,
        spin_offset: meshInstanceLayout.attrib.spinOffset,
        world_rotation: meshInstanceLayout.attrib.worldRotation,
        material: meshInstanceLayout.attrib.material
      },
      vertex: meshVertexMain,
      fragment: meshFragmentMain,
      targets: { format },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'back'
      },
      depthStencil: {
        format: DEPTH_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less'
      }
    })
    .$name('TypeGPU mesh pipeline');
}
