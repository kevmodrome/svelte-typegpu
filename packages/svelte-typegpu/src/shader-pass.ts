import { isTgpuFragmentFn } from 'typegpu';
import type { TypeGpuShaderPass, TypeGpuShaderPassUniformMap, Vector4Tuple } from './types';

export const DEFAULT_SHADER_PASS_UNIFORMS: TypeGpuShaderPassUniformMap = {
  time: 'time',
  resolution: 'resolution'
};

export interface ShaderPassUniformInput {
  time: number;
  width: number;
  height: number;
  uniforms?: TypeGpuShaderPassUniformMap;
}

export interface ShaderPassFrameUniformInput {
  time: number;
  renderSize: { width: number; height: number };
  uniforms?: TypeGpuShaderPassUniformMap;
}

export interface ShaderPassUniformWriter {
  write(data: ArrayBuffer): void;
}

const SHADER_PASS_VALUE_UNIFORM_NAMES = [
  'value0',
  'value1',
  'value2',
  'value3',
  'value4',
  'value5',
  'value6',
  'value7'
] as const;

type ShaderPassValueUniformName = (typeof SHADER_PASS_VALUE_UNIFORM_NAMES)[number];

export function normalizeShaderPassUniforms(value: unknown): TypeGpuShaderPassUniformMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SHADER_PASS_UNIFORMS };
  }

  const uniforms: TypeGpuShaderPassUniformMap = {};

  for (const [name, source] of Object.entries(value)) {
    if (name === 'time' && source === 'time') uniforms.time = source;
    if (name === 'resolution' && source === 'resolution') uniforms.resolution = source;
    if (isShaderPassValueUniformName(name)) {
      const vector = valueUniform(source);
      if (vector) uniforms[name] = vector;
    }
  }

  return uniforms;
}

export function isShaderPassFragment(value: unknown): value is TypeGpuShaderPass['fragment'] {
  if (!isTgpuFragmentFn(value)) return false;

  const input = value.shell.in as Record<string, { type?: string }> | undefined;
  const output = value.shell.out as { type?: string } | undefined;
  if (!input) return false;

  const inputKeys = Object.keys(input);

  return (
    inputKeys.length === 1 &&
    inputKeys[0] === 'uv' &&
    input.uv?.type === 'vec2f' &&
    output?.type === 'vec4f'
  );
}

export function shaderPassUniformsKey(uniforms: TypeGpuShaderPassUniformMap): string {
  return Object.entries(uniforms)
    .filter(([name]) => name === 'time' || name === 'resolution')
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
  renderSize,
  uniforms
}: ShaderPassFrameUniformInput): ArrayBuffer {
  return packShaderPassUniforms({
    time,
    width: renderSize.width,
    height: renderSize.height,
    uniforms
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
  height,
  uniforms = {}
}: ShaderPassUniformInput): ArrayBuffer {
  const data = new Float32Array(36);

  data[0] = time;
  data[1] = 0;
  data[2] = width;
  data[3] = height;

  for (let index = 0; index < SHADER_PASS_VALUE_UNIFORM_NAMES.length; index += 1) {
    const name = SHADER_PASS_VALUE_UNIFORM_NAMES[index];
    const vector = valueUniform(uniforms[name]);
    if (vector) data.set(vector, 4 + index * 4);
  }

  return data.buffer.slice(0);
}

function isShaderPassValueUniformName(name: string): name is ShaderPassValueUniformName {
  return SHADER_PASS_VALUE_UNIFORM_NAMES.includes(name as ShaderPassValueUniformName);
}

function valueUniform(value: unknown): Vector4Tuple | null {
  if (typeof value === 'number') {
    const scalar = finiteNumber(value);
    return scalar === null ? null : [scalar, 0, 0, 0];
  }

  if (!Array.isArray(value) || value.length < 2 || value.length > 4) return null;

  const x = finiteNumber(value[0]);
  const y = finiteNumber(value[1]);
  const z = value.length > 2 ? finiteNumber(value[2]) : 0;
  const w = value.length > 3 ? finiteNumber(value[3]) : 0;

  if (x === null || y === null || z === null || w === null) return null;

  return [x, y, z, w];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
