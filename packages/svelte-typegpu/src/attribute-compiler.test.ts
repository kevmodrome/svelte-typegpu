import { describe, expect, it } from 'vitest';
import MagicString from 'magic-string';
import remapping from '@jridgewell/remapping';
import { compileTypeGpu, prepareTypeGpuSource } from '../compiler/index';

const filename = 'Attributes.typegpu.svelte';

describe('structured attribute compilation', () => {
  it('leaves static values, inline tuples, scalar props and opaque resources unchanged', () => {
    const source = `<script>let { x, vertices, asset, fragment, onclick } = $props();</script>
      <scene clearColor={[0, 0, 0, 1]}>
        <mesh position={[x, 0, 0]} scale={2} rotation={{ x: 0, y: -1, z: 0 }} {onclick}>
          <bufferGeometry {vertices} bounds={{ min: [-1, -1, -1], max: [1, 1, 1] }} />
        </mesh><model {asset} /><shaderPass {fragment} uniforms={{ time: 'time' }} />
      </scene>`;
    expect(prepareTypeGpuSource(source, filename).code).toBe(source);
    expect(compileTypeGpu(source, { filename }).js.code).not.toContain('attribute-values');
  });

  it.each(['{position}', 'position={position}', 'position="{position}"'])(
    'adapts %s before the Svelte identity cache', (attribute) => {
      const source = `<script>let { position } = $props();</script><mesh ${attribute} />`;
      const prepared = prepareTypeGpuSource(source, filename);
      expect(prepared.code).toContain('position={TypeGpuAttributeValues.value("position", position)}');
      expect(prepared.map?.sourcesContent).toEqual([source]);
      expect(compileTypeGpu(source, { filename }).js.code).toContain('TypeGpuAttributeValues.value');
    }
  );

  it('tracks nested uniform vectors even in an inline record', () => {
    const source = '<script>let { tint } = $props();</script><shaderPass uniforms={{ value0: tint }} />';
    expect(prepareTypeGpuSource(source, filename).code).toContain(
      'uniforms={TypeGpuAttributeValues.value("uniforms", { value0: tint })}'
    );
  });

  it.each([false, true])('keeps helper names hygienic across script and snippet scopes (viewport %s)', (viewport) => {
    const snippet = `{#snippet marker(TypeGpuAttributeValues_)}
      <svelte:element this={'mesh'} {...TypeGpuAttributeValues_} />
    {/snippet}`;
    const content = '<scene>{@render marker({ position: [1, 0, 0] })}</scene>';
    const source = `<script>const TypeGpuAttributeValues = 1;</script>${snippet}` +
      (viewport ? `<canvas>${content}</canvas>` : content);
    const prepared = prepareTypeGpuSource(source, filename);
    expect(prepared.code).toContain('import * as TypeGpuAttributeValues__');
    expect(prepared.code).toContain('{...TypeGpuAttributeValues__.props(TypeGpuAttributeValues_)}');
    expect(prepared.code.match(/<script>/g)).toHaveLength(1);
    const compiled = compileTypeGpu(source, { filename, runes: true });
    expect(compiled.js.map?.sourcesContent).toEqual([source]);
  });

  it('leaves native canvas and wrapper component props to their own consumers', () => {
    const source = `<script>let { Component, properties, position } = $props();</script>
      <canvas {...properties}><Component {position} {...properties} />
        <scene><mesh {position} /></scene>
      </canvas>`;
    const prepared = prepareTypeGpuSource(source, filename);
    expect(prepared.code).toContain('<TypeGpuViewportCanvas {...properties}>');
    expect(prepared.code).toContain('<Component {position} {...properties} />');
    expect(prepared.code).toContain('<mesh position={TypeGpuAttributeValues.value("position", position)} />');
    expect(prepared.code).not.toContain('.props(');
  });

  it.each([false, true])('does not evaluate GPU value helpers during SSR (viewport %s)', (viewport) => {
    const snippet = `<script module>export { marker };</script>
      {#snippet marker(position)}<mesh {position} />{/snippet}`;
    const scene = '<scene>{@render marker([0, 0, 0])}</scene>';
    const source = snippet + (viewport ? `<canvas>${scene}</canvas>` : scene);
    const server = compileTypeGpu(source, { filename, generate: 'server', runes: true });
    expect(server.js.code).not.toContain('TypeGpuAttributeValues.value(');
    expect(server.js.code).not.toContain('<mesh');
    if (viewport) {
      expect(server.js.code).toContain('export { marker }');
      expect(server.js.map?.sourcesContent).toEqual([source]);
    } else {
      expect(server.js.code).toMatch(/^export default function \w+\(\) \{\}$/);
    }
  });

  it('composes caller preprocessing with value and canvas lowering back to the original source', () => {
    const original = `<script>
      let { position } = $props();
      export function read() { return position; }
    </script><canvas><scene><mesh {position} /></scene></canvas>
    <style>canvas { height: 420px; }</style>`;
    const input = new MagicString(original).prepend('<!-- preprocessed -->\n');
    const compiled = compileTypeGpu(input.toString(), {
      filename, runes: true, sourcemap: input.generateMap({ source: filename, includeContent: true, hires: true })
    });
    expect(compiled.js.map?.sourcesContent).toEqual([original]);
    expect(compiled.css?.map?.sourcesContent).toEqual([original]);
    const decoded = remapping(compiled.js.map as any, () => null, { decodedMappings: true }) as unknown as {
      mappings: number[][][];
    };
    const generatedLine = compiled.js.code.split('\n').findIndex(line => /return .*position/.test(line));
    expect(generatedLine).toBeGreaterThan(-1);
    expect(decoded.mappings[generatedLine].some(segment => segment[2] === 2)).toBe(true);
  });
});
