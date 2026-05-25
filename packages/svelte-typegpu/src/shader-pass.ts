import { isTgpuFragmentFn } from 'typegpu';
import type { TypeGpuShaderPass, TypeGpuShaderPassUniformMap } from './types';

export const DEFAULT_SHADER_PASS_UNIFORMS: TypeGpuShaderPassUniformMap = {
  time: 'time',
  resolution: 'resolution'
};

export interface ShaderPassUniformInput {
  time: number;
  width: number;
  height: number;
}

export interface ShaderPassFrameUniformInput {
  time: number;
  renderSize: { width: number; height: number };
}

export interface ShaderPassUniformWriter {
  write(data: ArrayBuffer): void;
}

export function normalizeShaderPassUniforms(value: unknown): TypeGpuShaderPassUniformMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SHADER_PASS_UNIFORMS };
  }

  const uniforms: TypeGpuShaderPassUniformMap = {};

  for (const [name, source] of Object.entries(value)) {
    if (name === 'time' && source === 'time') uniforms.time = source;
    if (name === 'resolution' && source === 'resolution') uniforms.resolution = source;
  }

  return uniforms;
}

export function isShaderPassFragment(value: unknown): value is TypeGpuShaderPass['fragment'] {
  if (!isTgpuFragmentFn(value)) return false;

  const input = value.shell.in as { uv?: { type?: string } } | undefined;
  const output = value.shell.out as { type?: string } | undefined;

  return input?.uv?.type === 'vec2f' && output?.type === 'vec4f';
}

export function shaderPassUniformsKey(uniforms: TypeGpuShaderPassUniformMap): string {
  return Object.entries(uniforms)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, source]) => `${name}:${source}`)
    .join(',');
}

const shaderPassFragmentIds = new WeakMap<object, number>();
let nextShaderPassFragmentId = 1;

export function shaderPassFragmentKey(fragment: TypeGpuShaderPass['fragment']): string {
  const cached = shaderPassFragmentIds.get(fragment);
  if (cached) return `fragment:${cached}`;

  const next = nextShaderPassFragmentId++;
  shaderPassFragmentIds.set(fragment, next);
  return `fragment:${next}`;
}

export function shaderPassPipelineResourceKey(pass: TypeGpuShaderPass, depth: boolean): string {
  return [
    shaderPassFragmentKey(pass.fragment),
    `uniforms:${shaderPassUniformsKey(pass.uniforms)}`,
    `sceneDepth:${depth ? 'enabled' : 'disabled'}`
  ].join('|');
}

export function packShaderPassFrameUniforms({
  time,
  renderSize
}: ShaderPassFrameUniformInput): ArrayBuffer {
  return packShaderPassUniforms({
    time,
    width: renderSize.width,
    height: renderSize.height
  });
}

export function writeShaderPassFrameUniforms(
  buffer: ShaderPassUniformWriter,
  input: ShaderPassFrameUniformInput
): void {
  buffer.write(packShaderPassFrameUniforms(input));
}

export function packShaderPassUniforms({
  time,
  width,
  height
}: ShaderPassUniformInput): ArrayBuffer {
  const data = new Float32Array(4);

  data[0] = time;
  data[1] = 0;
  data[2] = width;
  data[3] = height;

  return data.buffer.slice(0);
}
