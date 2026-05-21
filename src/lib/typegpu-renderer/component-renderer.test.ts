import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import * as svelteClient from 'svelte/internal/client';
import { describe, expect, it, vi } from 'vitest';
import { createFragment, type TypeGpuNode } from './core';
import renderer from './svelte-renderer';
import type { RgbaTuple, Vector3Tuple } from './types';

describe('TypeGPU component renderer integration', () => {
  it('renders Box as a mesh with box geometry and standard material', () => {
    const Box = loadTypeGpuComponent('src/Box.typegpu.svelte');
    const root = createFragment();
    const position = [1, 2, 3] as Vector3Tuple;
    const color = [0.1, 0.2, 0.3, 1] as RgbaTuple;

    renderer.render(Box, {
      target: root,
      props: {
        position,
        phase: 0.25,
        color,
        width: 4,
        height: 5,
        depth: 6,
        spinSpeed: 1.4,
        onclick: vi.fn()
      }
    });

    const mesh = onlyElement(root);
    const [geometry, material] = mesh.children;

    expect(mesh.name).toBe('mesh');
    expect(mesh.attributes).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change box color',
      position,
      phase: 0.25,
      spinSpeed: 1.4
    });
    expect(geometry.name).toBe('boxGeometry');
    expect(geometry.attributes).toMatchObject({
      width: 4,
      height: 5,
      depth: 6
    });
    expect(material.name).toBe('standardMaterial');
    expect(material.attributes.color).toBe(color);
  });

  it('renders Sphere as a mesh with sphere geometry and standard material', () => {
    const Sphere = loadTypeGpuComponent('src/Sphere.typegpu.svelte');
    const root = createFragment();
    const position = [7, 8, 9] as Vector3Tuple;
    const color = [0.7, 0.8, 0.9, 1] as RgbaTuple;

    renderer.render(Sphere, {
      target: root,
      props: {
        position,
        phase: 0.75,
        color,
        radius: 2,
        spinSpeed: 0.8,
        onclick: vi.fn()
      }
    });

    const mesh = onlyElement(root);
    const [geometry, material] = mesh.children;

    expect(mesh.name).toBe('mesh');
    expect(mesh.attributes).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change sphere color',
      position,
      phase: 0.75,
      spinSpeed: 0.8
    });
    expect(geometry.name).toBe('sphereGeometry');
    expect(geometry.attributes).toMatchObject({
      radius: 2
    });
    expect(material.name).toBe('standardMaterial');
    expect(material.attributes.color).toBe(color);
  });
});

function onlyElement(root: TypeGpuNode): TypeGpuNode {
  const elements = root.children.filter((node) => node.kind === 'element');

  expect(elements).toHaveLength(1);

  return elements[0];
}

function loadTypeGpuComponent(filename: string) {
  const source = readFileSync(filename, 'utf8');
  const result = compile(source, {
    filename,
    generate: 'client',
    runes: true,
    experimental: {
      customRenderer: '/src/lib/typegpu-renderer/svelte-renderer.ts'
    }
  });
  const componentName = result.js.code.match(/export default function ([^(]+)/)?.[1];
  if (!componentName) throw new Error(`Unable to find compiled component name for ${filename}`);

  const executableCode = result.js.code
    .replace("import $renderer from '/src/lib/typegpu-renderer/svelte-renderer.ts';", '')
    .replace("import 'svelte/internal/disclose-version';", '')
    .replace("import * as $ from 'svelte/internal/client';", '')
    .replace(`export default function ${componentName}`, `function ${componentName}`);
  const createComponent = new Function(
    '$',
    '$renderer',
    `${executableCode}\nreturn ${componentName};`
  );

  return createComponent(svelteClient, renderer) as Parameters<typeof renderer.render>[0];
}
