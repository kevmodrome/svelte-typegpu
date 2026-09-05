import { describe, expect, it, vi } from 'vitest';
import { compile } from 'svelte/compiler';
import { adaptViewportClient, compileTypeGpu, omitViewportScene, prepareTypeGpuSource } from '../compiler/index';

const filename = 'Example.typegpu.svelte';
const diagnostics = (source: string) => prepareTypeGpuSource(source, filename).warnings;

describe('static scene diagnostics', () => {
  it('reports original tag locations and useful spelling suggestions', () => {
    const source = '<canvas>\n  <scene>\n    <mesh><boxGeomtry /></mesh>\n  </scene>\n</canvas>';
    const [warning] = diagnostics(source);
    const start = source.indexOf('boxGeomtry');
    expect(warning).toMatchObject({
      code: 'typegpu_unknown_primitive', filename,
      start: { line: 3, column: 11, character: start },
      end: { line: 3, column: 21, character: start + 10 },
      position: [start, start + 10]
    });
    expect(warning.message).toContain('Did you mean <boxGeometry>?');
    expect(warning.frame).toBe('1: <canvas>\n2:   <scene>\n3:     <mesh><boxGeomtry /></mesh>\n              ^\n4:   </scene>\n5: </canvas>');
  });

  it('handles CRLF and tabs in source frames', () => {
    const [warning] = diagnostics('<scene>\r\n\t<boxGeomtry />\r\n</scene>');
    expect(warning.start).toMatchObject({ line: 2, column: 2 });
    expect(warning.frame).toContain('2:   <boxGeomtry />\n      ^');
    expect(warning.frame).not.toContain('\r');
  });

  it.each(['boxgeometry', 'box-geomtry'])('suggests canonical names for %s', (name) => {
    expect(diagnostics(`<${name} />`)[0].message).toContain('Did you mean <boxGeometry>?');
  });

  it('does not invent suggestions for unrelated custom names', () => {
    expect(diagnostics('<custom-particle-system />')[0].message).not.toContain('Did you mean');
  });

  it.each([
    ['group', 'boxGeometry'], ['scene', 'planeGeometry'], ['model', 'sphereGeometry'],
    ['boxGeometry', 'bufferGeometry'], ['group', 'basicMaterial'], ['scene', 'phongMaterial'],
    ['mesh', 'standardMaterial'], ['model', 'shaderMaterial'],
    ['orthographicCamera', 'cameraPose'], ['scene', 'cameraLens'], ['group', 'controls'],
    ['orbitControls', 'pointerControls'], ['mesh', 'keyboardControls']
  ])('checks the actual direct-parent contract for <%s><%s>', (parent, child) => {
    const warnings = diagnostics(`<${parent}><${child} /></${parent}>`);
    const valid = (parent === 'mesh' && child === 'standardMaterial') || (parent === 'model' && child === 'shaderMaterial');
    expect(warnings).toHaveLength(valid ? 0 : 1);
    if (!valid) {
      expect(warnings[0].code).toBe('typegpu_invalid_parent');
      expect(warnings[0].message).toContain(`its parent is <${parent}>`);
    }
  });

  it('accepts built-ins and aliases in their supported positions', () => {
    expect(diagnostics(`<canvas aria-label="Preview" style="height: 300px" class={{ active: true }}>
      <scene><group><mesh phase={0}><box-geometry /><planeGeometry /><sphereGeometry /><bufferGeometry />
        <basic-material /><phongMaterial /><standardMaterial /><shaderMaterial /></mesh>
        <model><basicMaterial /></model>
        <perspective-camera><cameraPose /><cameraLens /><controls><pointerControls /><keyboardControls /></controls></perspective-camera>
        <orthographic-camera /><orbit-controls><keyboardControls /></orbit-controls>
        <ambient-light /><hemisphere-light /><directional-light /><point-light /><spot-light />
        <shader-pass /><frame-task />
      </group></scene></canvas>`)).toEqual([]);
  });

  it.each(['boxGeometry', 'basicMaterial', 'cameraPose', 'keyboardControls'])('allows reusable <%s> root fragments', (name) => {
    expect(diagnostics(`<${name} />`)).toEqual([]);
  });

  it('does not infer attachment points across components, snippet definitions or dynamic tags', () => {
    expect(diagnostics(`<scene>
      <Reusable><boxGeometry /></Reusable>
      <svelte:component this={Reusable}><basicMaterial /></svelte:component>
      {#if recurse}<svelte:self><cameraLens /></svelte:self>{/if}
      {#snippet resources()}<boxGeometry /><phongMaterial />{/snippet}
      <svelte:element this={tag}><cameraPose /></svelte:element>
    </scene>`)).toEqual([]);
  });

  it('still checks definite relationships inside components and snippets', () => {
    const warnings = diagnostics(`<Reusable><group><boxGeometry /></group></Reusable>
      {#snippet resources()}<scene><basicMaterial /></scene>{/snippet}`);
    expect(warnings.map((warning) => warning.code)).toEqual(['typegpu_invalid_parent', 'typegpu_invalid_parent']);
  });

  it.each([
    '{#if ok}<boxGeometry />{:else}<planeGeometry />{/if}',
    '{#each items as item}<boxGeometry />{:else}<planeGeometry />{/each}',
    '{#await promise}<boxGeometry />{:then value}<planeGeometry />{:catch error}<sphereGeometry />{/await}',
    '{#key key}<boxGeometry />{/key}',
    '<svelte:boundary><boxGeometry /></svelte:boundary>'
  ])('preserves host parent through control flow: %s', (children) => {
    expect(diagnostics(`<mesh>${children}</mesh>`)).toEqual([]);
    const warnings = diagnostics(`<group>${children}</group>`);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.every((warning) => warning.code === 'typegpu_invalid_parent')).toBe(true);
  });

  it('checks literal dynamic-element tags, but does not guess computed tags', () => {
    const source = `<scene><svelte:element this={'mesh'}><svelte:element this={'boxGeometry'} /></svelte:element>
      <svelte:element this={'boxGeomtry'} /><svelte:element this={'planeGeometry'} />
      <svelte:element this={tag}><basicMaterial /></svelte:element></scene>`;
    const warnings = diagnostics(source);
    expect(warnings.map((warning) => warning.code)).toEqual(['typegpu_unknown_primitive', 'typegpu_invalid_parent']);
    expect(source.slice(...warnings[0].position!)).toBe("'boxGeomtry'");
  });

  it('warns once for an unknown parent without cascading speculative parent warnings', () => {
    expect(diagnostics('<custom-container><boxGeometry /></custom-container>')).toHaveLength(1);
  });

  it.each(['texture', 'sampler'])('does not claim inline <%s> is implemented', (name) => {
    expect(diagnostics(`<mesh><${name} /></mesh>`)[0].code).toBe('typegpu_unknown_primitive');
  });

  it.each(['client', 'server'] as const)('returns filterable original-source warnings without runtime changes (%s)', (generate) => {
    const source = '<canvas><scene><boxGeomtry /><boxGeometry /></scene></canvas>';
    const compiled = compileTypeGpu(source, { filename, generate });
    expect(compiled.warnings.map((warning) => warning.code)).toEqual(['typegpu_unknown_primitive', 'typegpu_invalid_parent']);
    const filter = vi.fn(() => false);
    const filtered = compileTypeGpu(source, { filename, generate, warningFilter: filter });
    expect(filter).toHaveBeenCalledTimes(2);
    expect(filtered.warnings).toEqual([]);
    expect(filtered.js).toEqual(compiled.js);
    const prepared = prepareTypeGpuSource(source, filename);
    const plain = compile(generate === 'server' ? omitViewportScene(prepared.code, filename).code : prepared.code, {
      filename, generate, experimental: { customRenderer: generate === 'server' ? () => null : 'svelte-typegpu/svelte-renderer' }
    });
    const expected = generate === 'server' ? plain.js.code : adaptViewportClient(plain.js.code).code;
    expect(compiled.js.code).toBe(expected);
    expect(compiled.js.code).not.toContain('typegpu_unknown_primitive');
  });

  it('preserves Svelte warnings and calls the filter once per diagnostic', () => {
    const filter = vi.fn(() => true);
    const result = compileTypeGpu('<script>let value = 0;</script><scene phase={value++}><boxGeomtry /></scene>', {
      filename, runes: true, warningFilter: filter
    });
    expect(result.warnings.map((warning) => warning.code)).toContain('non_reactive_update');
    expect(result.warnings.map((warning) => warning.code)).toContain('typegpu_unknown_primitive');
    expect(filter).toHaveBeenCalledTimes(result.warnings.length);
  });
});
