import tgpu, { d } from 'typegpu';
import { shaderPassBindGroupLayout } from 'svelte-typegpu';

const aspectCorrected = tgpu
  .fn([d.vec2f], d.vec2f)/* wgsl */ `(uv) {
    let resolution = shaderPassBindGroupLayout.$.uniforms.resolution;
    var v = (uv - 0.5) * 2.0;
    let aspect = resolution.x / resolution.y;

    if (aspect > 1.0) {
      v.x = v.x * aspect;
    } else {
      v.y = v.y / aspect;
    }

    return v;
  }`
  .$uses({ shaderPassBindGroupLayout })
  .$name('aspectCorrected');

const palette = tgpu
  .fn([d.f32], d.vec3f)/* wgsl */ `(t) {
    let a = vec3f(0.5, 0.59, 0.85);
    let b = vec3f(0.18, 0.42, 0.4);
    let c = vec3f(0.18, 0.48, 0.41);
    let e = vec3f(0.35, 0.13, 0.32);

    return a + b * cos(6.28318 * (c * t + e));
  }`
  .$name('palette');

const accumulate = tgpu
  .fn([d.vec3f, d.vec3f, d.f32], d.vec3f)/* wgsl */ `(acc, col, weight) {
    return acc + col * weight;
  }`
  .$name('accumulate');

const discoUses = {
  shaderPassBindGroupLayout,
  aspectCorrected,
  palette,
  accumulate
};

export const discoFragment1 = tgpu
  .fragmentFn({
    in: { uv: d.vec2f },
    out: d.vec4f
  })/* wgsl */ `{
    let time = shaderPassBindGroupLayout.$.uniforms.time;
    let originalUv = aspectCorrected(in.uv);
    var aspectUv = originalUv;
    var accumulatedColor = vec3f();

    for (var iteration = 0; iteration < 5; iteration = iteration + 1) {
      aspectUv = fract(aspectUv * (1.3 * sin(time))) - 0.5;
      var radialLength = length(aspectUv) * exp(-length(originalUv) * 2.0);
      radialLength = sin(radialLength * 8.0 + time) / 8.0;
      radialLength = abs(radialLength);
      radialLength = smoothstep(0.0, 0.1, radialLength);
      radialLength = 0.06 / radialLength;

      let paletteColor = palette(length(originalUv) + time * 0.9);
      accumulatedColor = accumulate(accumulatedColor, paletteColor, radialLength);
    }

    return vec4f(accumulatedColor, 1.0);
  }`
  .$uses(discoUses)
  .$name('discoFragment1');

export const discoFragment = discoFragment1;

export const discoFragment2 = tgpu
  .fragmentFn({
    in: { uv: d.vec2f },
    out: d.vec4f
  })/* wgsl */ `{
    let time = shaderPassBindGroupLayout.$.uniforms.time;
    let originalUv = aspectCorrected(in.uv);
    var aspectUv = originalUv;
    var accumulatedColor = vec3f();

    for (var iteration = 0; iteration < 3; iteration = iteration + 1) {
      aspectUv = fract(aspectUv * -0.9) - 0.5;
      var radialLength = length(aspectUv) * exp(-length(originalUv) * 0.5);
      let paletteColor = palette(length(originalUv) + time * 0.9);
      radialLength = sin(radialLength * 8.0 + time) / 8.0;
      radialLength = abs(radialLength);
      radialLength = smoothstep(0.0, 0.1, radialLength);
      radialLength = 0.1 / radialLength;
      accumulatedColor = accumulate(accumulatedColor, paletteColor, radialLength);
    }

    return vec4f(accumulatedColor, 1.0);
  }`
  .$uses(discoUses)
  .$name('discoFragment2');

export const discoFragment3 = tgpu
  .fragmentFn({
    in: { uv: d.vec2f },
    out: d.vec4f
  })/* wgsl */ `{
    let time = shaderPassBindGroupLayout.$.uniforms.time;
    let originalUv = aspectCorrected(in.uv);
    var aspectUv = originalUv;
    var accumulatedColor = vec3f();
    let baseAngle = time * 0.3;
    let cosBaseAngle = cos(baseAngle);
    let sinBaseAngle = sin(baseAngle);

    for (var iteration = 0; iteration < 4; iteration = iteration + 1) {
      let iterationF32 = f32(iteration);
      let rotatedX = aspectUv.x * cosBaseAngle - aspectUv.y * sinBaseAngle;
      let rotatedY = aspectUv.x * sinBaseAngle + aspectUv.y * cosBaseAngle;
      aspectUv = vec2f(rotatedX, rotatedY);
      aspectUv = aspectUv * (1.15 + iterationF32 * 0.05);
      aspectUv = fract(aspectUv * (1.2 * sin(time * 0.9 + iterationF32 * 0.3))) - 0.5;

      var radialLength = length(aspectUv) * exp(-length(originalUv) * 1.6);
      let paletteColor = palette(length(originalUv) + time * 0.8 + iterationF32 * 0.05);
      radialLength = sin(radialLength * 7.0 + time * 0.9) / 8.0;
      radialLength = abs(radialLength);
      radialLength = smoothstep(0.0, 0.11, radialLength);
      radialLength = 0.055 / (radialLength + 1e-5);
      accumulatedColor = accumulate(accumulatedColor, paletteColor, radialLength);
    }

    return vec4f(accumulatedColor, 1.0);
  }`
  .$uses(discoUses)
  .$name('discoFragment3');

export const discoFragment4 = tgpu
  .fragmentFn({
    in: { uv: d.vec2f },
    out: d.vec4f
  })/* wgsl */ `{
    var aspectUv = aspectCorrected(in.uv);
    let mirroredUv = (vec2f(abs(fract(aspectUv.x * 1.2) - 0.5), abs(fract(aspectUv.y * 1.2) - 0.5)) * 2.0) - 1.0;
    aspectUv = mirroredUv;
    let originalUv = aspectUv;
    var accumulatedColor = vec3f(0.0, 0.0, 0.0);
    let time = shaderPassBindGroupLayout.$.uniforms.time;

    for (var iteration = 0; iteration < 4; iteration = iteration + 1) {
      let iterationF32 = f32(iteration);
      let angle = time * (0.4 + iterationF32 * 0.1) + iterationF32 * 0.9;
      let cosAngle = cos(angle);
      let sinAngle = sin(angle);
      let rotatedX = aspectUv.x * cosAngle - aspectUv.y * sinAngle;
      let rotatedY = aspectUv.x * sinAngle + aspectUv.y * cosAngle;
      aspectUv = vec2f(rotatedX, rotatedY) * (1.1 + iterationF32 * 0.07);
      aspectUv = fract(aspectUv * (1.25 + iterationF32 * 0.15)) - 0.5;

      var radialLength = length(aspectUv) * exp(-length(originalUv) * (1.3 + iterationF32 * 0.06));
      radialLength = sin(radialLength * (7.2 + iterationF32 * 0.8) + time * (1.1 + iterationF32 * 0.2)) / 8.0;
      radialLength = abs(radialLength);
      radialLength = smoothstep(0.0, 0.105, radialLength);
      radialLength = (0.058 + iterationF32 * 0.006) / (radialLength + 1e-5);
      let paletteColor = palette(length(originalUv) + time * 0.65 + iterationF32 * 0.045);
      accumulatedColor = accumulate(accumulatedColor, paletteColor, radialLength);
    }

    return vec4f(accumulatedColor, 1.0);
  }`
  .$uses(discoUses)
  .$name('discoFragment4');

export const discoFragment5 = tgpu
  .fragmentFn({
    in: { uv: d.vec2f },
    out: d.vec4f
  })/* wgsl */ `{
    let time = shaderPassBindGroupLayout.$.uniforms.time;
    let originalUv = aspectCorrected(in.uv);
    var aspectUv = originalUv;
    var accumulatedColor = vec3f();

    for (var iteration = 0; iteration < 3; iteration = iteration + 1) {
      let iterationF32 = f32(iteration);
      let radius = length(aspectUv) + 1e-4;
      let angle = radius * (8.0 + iterationF32 * 2.0) - time * (1.5 + iterationF32 * 0.2);
      let cosAngle = cos(angle);
      let sinAngle = sin(angle);
      let rotatedX = aspectUv.x * cosAngle - aspectUv.y * sinAngle;
      let rotatedY = aspectUv.x * sinAngle + aspectUv.y * cosAngle;
      aspectUv = vec2f(rotatedX, rotatedY) * (-0.85 - iterationF32 * 0.07);
      aspectUv = fract(aspectUv) - 0.5;

      var radialLength = length(aspectUv) * exp(-length(originalUv) * (0.4 + iterationF32 * 0.1));
      let paletteColor = palette(length(originalUv) + time * 0.9 + iterationF32 * 0.08);
      radialLength = sin(radialLength * (6.0 + iterationF32) + time) / 8.0;
      radialLength = abs(radialLength);
      radialLength = smoothstep(0.0, 0.1, radialLength);
      radialLength = (0.085 + iterationF32 * 0.005) / (radialLength + 1e-5);
      accumulatedColor = accumulate(accumulatedColor, paletteColor, radialLength);
    }

    return vec4f(accumulatedColor, 1.0);
  }`
  .$uses(discoUses)
  .$name('discoFragment5');

export const discoFragment6 = tgpu
  .fragmentFn({
    in: { uv: d.vec2f },
    out: d.vec4f
  })/* wgsl */ `{
    var aspectUv = aspectCorrected(in.uv);
    let originalUv = aspectUv;
    var accumulatedColor = vec3f(0.0, 0.0, 0.0);
    let time = shaderPassBindGroupLayout.$.uniforms.time;

    for (var iteration = 0; iteration < 5; iteration = iteration + 1) {
      let iterationF32 = f32(iteration);
      let angle = time * (0.25 + iterationF32 * 0.05) + iterationF32 * 0.6;
      let cosAngle = cos(angle);
      let sinAngle = sin(angle);
      let rotatedX = aspectUv.x * cosAngle - aspectUv.y * sinAngle;
      let rotatedY = aspectUv.x * sinAngle + aspectUv.y * cosAngle;
      aspectUv = vec2f(rotatedX, rotatedY) * (1.08 + iterationF32 * 0.04);

      let warpedUv = fract(aspectUv * (1.3 + iterationF32 * 0.2)) - 0.5;
      var radialLength = length(warpedUv) * exp(-length(originalUv) * (1.4 + iterationF32 * 0.05));
      radialLength = sin(radialLength * (7.0 + iterationF32 * 0.7) + time * (0.9 + iterationF32 * 0.15)) / 8.0;
      radialLength = abs(radialLength);
      radialLength = smoothstep(0.0, 0.1, radialLength);
      radialLength = (0.05 + iterationF32 * 0.005) / (radialLength + 1e-5);
      let paletteColor = palette(length(originalUv) + time * 0.7 + iterationF32 * 0.04);
      accumulatedColor = accumulate(accumulatedColor, paletteColor, radialLength);
    }

    return vec4f(accumulatedColor, 1.0);
  }`
  .$uses(discoUses)
  .$name('discoFragment6');

export const discoFragment7 = tgpu
  .fragmentFn({
    in: { uv: d.vec2f },
    out: d.vec4f
  })/* wgsl */ `{
    var aspectUv = aspectCorrected(in.uv);
    aspectUv = vec2f(abs(fract(aspectUv.x * 1.5) - 0.5), abs(fract(aspectUv.y * 1.5) - 0.5)) * 2.0;
    let originalUv = aspectUv;
    var accumulatedColor = vec3f(0.0, 0.0, 0.0);
    let time = shaderPassBindGroupLayout.$.uniforms.time;

    for (var iteration = 0; iteration < 4; iteration = iteration + 1) {
      let iterationF32 = f32(iteration);
      let angle = iterationF32 * 0.8 + time * 0.35;
      let cosAngle = cos(angle);
      let sinAngle = sin(angle);
      let rotatedX = aspectUv.x * cosAngle - aspectUv.y * sinAngle;
      let rotatedY = aspectUv.x * sinAngle + aspectUv.y * cosAngle;
      aspectUv = vec2f(rotatedX, rotatedY) * (1.18 + iterationF32 * 0.06);

      let radius = length(aspectUv) + 1e-4;
      let swirl = sin(radius * 10.0 - time * (1.2 + iterationF32 * 0.2));
      aspectUv = aspectUv + vec2f(swirl * 0.02, swirl * -0.02);

      var radialLength = length(aspectUv) * exp(-length(originalUv) * (1.2 + iterationF32 * 0.08));
      radialLength = sin(radialLength * (7.5 + iterationF32) + time * (1.0 + iterationF32 * 0.1)) / 8.0;
      radialLength = abs(radialLength);
      radialLength = smoothstep(0.0, 0.11, radialLength);
      radialLength = (0.06 + iterationF32 * 0.005) / (radialLength + 1e-5);
      let paletteColor = palette(length(originalUv) + time * 0.75 + iterationF32 * 0.05);
      accumulatedColor = accumulate(accumulatedColor, paletteColor, radialLength);
    }

    return vec4f(accumulatedColor, 1.0);
  }`
  .$uses(discoUses)
  .$name('discoFragment7');
