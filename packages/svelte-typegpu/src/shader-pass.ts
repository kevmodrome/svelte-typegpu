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

export function normalizeShaderPassUniforms(value: unknown): TypeGpuShaderPassUniformMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_SHADER_PASS_UNIFORMS };
  }

  const uniforms: TypeGpuShaderPassUniformMap = {};

  for (const [name, source] of Object.entries(value)) {
    if (
      (name === 'time' && source === 'time') ||
      (name === 'resolution' && source === 'resolution')
    ) {
      uniforms[name] = source;
    }
  }

  return uniforms;
}

export function shaderPassUniformsKey(uniforms: TypeGpuShaderPassUniformMap): string {
  return Object.entries(uniforms)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, source]) => `${name}:${source}`)
    .join(',');
}

export function shaderPassPipelineResourceKey(pass: TypeGpuShaderPass, depth: boolean): string {
  return [
    pass.key,
    `revision:${pass.revision}`,
    `uniforms:${shaderPassUniformsKey(pass.uniforms)}`,
    `sceneDepth:${depth ? 'enabled' : 'disabled'}`
  ].join('|');
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
