import tgpu, { d, type TgpuRenderPipeline, type TgpuRoot } from 'typegpu';
import { DEPTH_FORMAT } from './render-constants';
import {
  lightingBindGroupLayout,
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
      instance_position: d.vec3f,
      phase: d.f32,
      color: d.vec4f,
      shape: d.vec4f,
      spin_offset: d.f32,
      world_rotation: d.vec3f,
      material: d.vec2f
    },
    out: {
      position: d.builtin.position,
      color: d.location(0, d.vec4f),
      normal: d.location(1, d.vec3f),
      material: d.location(2, d.vec2f),
      world_position: d.location(3, d.vec3f)
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
    output.world_position = world_position;

    return output;
  }`
  .$uses({ rotate_x: rotateX, rotate_y: rotateY, rotate_z: rotateZ, sceneBindGroupLayout })
  .$name('meshVertexMain');

const evaluateLight = tgpu
  .fn([d.u32, d.vec3f, d.vec3f, d.vec3f, d.f32, d.f32], d.vec3f)/* wgsl */ `(
    index,
    world_position,
    normal,
    base_color,
    roughness,
    metalness
  ) {
    let lightingBindGroupLayout_light = lightingBindGroupLayout.$.lighting.lights[index];
    let kind = lightingBindGroupLayout_light.kind;
    let intensity = max(lightingBindGroupLayout_light.color_intensity.a, 0.0);
    let light_color = lightingBindGroupLayout_light.color_intensity.rgb * intensity;
    let diffuse_weight = mix(1.0, 0.68, roughness);
    let specular_weight = mix(0.08, 0.32, metalness) * (1.0 - roughness * 0.75);

    if (kind == 1u) {
      return base_color * light_color;
    }

    if (kind == 2u) {
      let sky_direction = normalize(lightingBindGroupLayout_light.direction_angle.xyz);
      let hemisphere_mix = dot(normal, sky_direction) * 0.5 + 0.5;
      let hemisphere_color = mix(
        lightingBindGroupLayout_light.secondary_color.rgb,
        lightingBindGroupLayout_light.color_intensity.rgb,
        clamp(hemisphere_mix, 0.0, 1.0)
      ) * intensity;

      return base_color * hemisphere_color;
    }

    var light_direction = vec3(0.0);
    var attenuation = 1.0;

    if (kind == 3u) {
      light_direction = normalize(-lightingBindGroupLayout_light.direction_angle.xyz);
    } else if (kind == 4u || kind == 5u) {
      let to_light = lightingBindGroupLayout_light.position_range.xyz - world_position;
      let distance = max(length(to_light), 0.0001);
      let range = lightingBindGroupLayout_light.position_range.w;
      let decay = max(lightingBindGroupLayout_light.params.x, 0.0001);

      light_direction = to_light / distance;

      if (range > 0.0) {
        attenuation = pow(clamp(1.0 - distance / range, 0.0, 1.0), decay);
      } else {
        attenuation = 1.0 / pow(max(distance, 1.0), decay);
      }

      if (kind == 5u) {
        let spot_axis = normalize(lightingBindGroupLayout_light.direction_angle.xyz);
        let spot_angle = lightingBindGroupLayout_light.direction_angle.w;
        let penumbra = clamp(lightingBindGroupLayout_light.params.y, 0.0, 1.0);
        let inner_angle = spot_angle * (1.0 - penumbra);
        let spot_cos = dot(spot_axis, -light_direction);
        let spot_falloff = smoothstep(cos(spot_angle), cos(inner_angle), spot_cos);

        attenuation = attenuation * spot_falloff;
      }
    } else {
      return vec3(0.0);
    }

    let diffuse = max(dot(normal, light_direction), 0.0) * diffuse_weight;
    let specular = pow(max(dot(normal, light_direction), 0.0), mix(32.0, 8.0, roughness)) *
      specular_weight;

    return (base_color * diffuse + vec3(specular)) * light_color * attenuation;
  }`
  .$uses({ lightingBindGroupLayout })
  .$name('evaluate_light');

const evaluateLighting = tgpu
  .fn([d.vec3f, d.vec3f, d.vec3f, d.f32, d.f32], d.vec3f)/* wgsl */ `(
    world_position,
    normal,
    base_color,
    roughness,
    metalness
  ) {
    var lighting_normal = vec3(0.0, 0.0, 1.0);
    let normal_length = length(normal);

    if (normal_length > 0.0001) {
      lighting_normal = normal / normal_length;
    }

    let lightingBindGroupLayout_count = min(lightingBindGroupLayout.$.lighting.count, 32u);

    if (lightingBindGroupLayout_count == 0u) {
      let fallback_light = normalize(vec3(0.45, 0.78, 0.6));
      let diffuse = max(dot(lighting_normal, fallback_light), 0.0);
      let shade = 0.24 + diffuse * mix(0.78, 0.58, roughness);
      let lift = metalness * 0.08;

      return clamp(base_color * shade + lift, vec3(0.0), vec3(1.0));
    }

    var lit_color = vec3(0.0);

    for (var index = 0u; index < lightingBindGroupLayout_count; index = index + 1u) {
      lit_color = lit_color +
        evaluate_light(index, world_position, lighting_normal, base_color, roughness, metalness);
    }

    return clamp(lit_color, vec3(0.0), vec3(1.0));
  }`
  .$uses({ evaluate_light: evaluateLight, lightingBindGroupLayout })
  .$name('evaluate_lighting');

export const meshFragmentMain = tgpu
  .fragmentFn({
    in: {
      color: d.location(0, d.vec4f),
      normal: d.location(1, d.vec3f),
      material: d.location(2, d.vec2f),
      world_position: d.location(3, d.vec3f)
    },
    out: d.vec4f
  })/* wgsl */ `{
    let roughness = clamp(in.material.x, 0.0, 1.0);
    let metalness = clamp(in.material.y, 0.0, 1.0);
    let shifted_color = rotate_hue(
      in.color.rgb,
      sceneBindGroupLayout.$.scene.color_transform.x
    );
    let lit_color = evaluate_lighting(
      in.world_position,
      in.normal,
      shifted_color,
      roughness,
      metalness
    );

    return vec4(lit_color, in.color.a);
  }`
  .$uses({
    evaluate_lighting: evaluateLighting,
    rotate_hue: rotateHue,
    sceneBindGroupLayout
  })
  .$name('meshFragmentMain');

export function createMeshPipeline(root: TgpuRoot, format: GPUTextureFormat): TgpuRenderPipeline {
  return root
    .createRenderPipeline({
      attribs: {
        position: meshVertexLayout.attrib.position,
        normal: meshVertexLayout.attrib.normal,
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
