import { compile } from 'svelte/compiler';
import * as svelteClient from 'svelte/internal/client';
import { describe, expect, it, vi } from 'vitest';
import { createFragment, type TypeGpuNode } from './core';
import renderer from './svelte-renderer';
import { typeGpuRendererPath } from './test-paths';

describe('TypeGPU target primitive component rendering', () => {
  it('renders guide-level scene primitives into normalized host nodes', () => {
    const onClick = vi.fn();
    const Scene = compileTypeGpuSource(`
      <script>
        let { onClick } = $props();
      </script>

      <scene clearColor={[0, 0, 0, 1]}>
        <perspectiveCamera id="main" active={true} position={[0, 0, 10]} target={[0, 0, 0]} />
        <orbitControls camera="main" target={[0, 0, 0]} minDistance={2} maxDistance={40} />
        <ambientLight intensity={0.2} />
        <directionalLight position={[1, 2, 3]} />
        <mesh position={[1, 2, 3]} onclick={onClick}>
          <boxGeometry width={1} height={2} depth={3} />
          <phongMaterial
            map="/textures/checker.svg"
            sampler={{ addressModeU: 'repeat', addressModeV: 'repeat' }}
            color={[1, 0.8, 0.4, 1]}
          />
        </mesh>
      </scene>
    `);
    const root = createFragment();

    renderer.render(Scene, { target: root, props: { onClick } });

    const scene = onlyElement(root);
    const camera = onlyNamed(scene, 'perspectiveCamera');
    const orbitControls = onlyNamed(scene, 'orbitControls');
    const mesh = onlyNamed(scene, 'mesh');
    const boxGeometry = onlyNamed(mesh, 'boxGeometry');
    const material = onlyNamed(mesh, 'phongMaterial');

    expect(scene.attributes.clearColor).toEqual([0, 0, 0, 1]);
    expect(camera.attributes).toMatchObject({
      id: 'main',
      active: true,
      position: [0, 0, 10],
      target: [0, 0, 0]
    });
    expect(orbitControls.attributes).toMatchObject({
      camera: 'main',
      minDistance: 2,
      maxDistance: 40
    });
    expect(boxGeometry.attributes).toMatchObject({
      width: 1,
      height: 2,
      depth: 3
    });
    expect(material.attributes).toMatchObject({
      map: '/textures/checker.svg',
      sampler: { addressModeU: 'repeat', addressModeV: 'repeat' },
      color: [1, 0.8, 0.4, 1]
    });
    expect(mesh.attributes).toMatchObject({
      position: [1, 2, 3]
    });
    expect(mesh.listeners.get('click')?.size).toBe(1);
  });

  it('renders each-loop component meshes as ordinary batchable mesh nodes', () => {
    const Scene = compileTypeGpuSource(`
      <script>
        const cubes = [
          { id: 'a', position: [0, 0, 0], color: [1, 0, 0, 1] },
          { id: 'b', position: [1, 0, 0], color: [0, 1, 0, 1] },
          { id: 'c', position: [2, 0, 0], color: [0, 0, 1, 1] }
        ];
      </script>

      {#snippet Cube(cube)}
        <mesh position={cube.position}>
          <boxGeometry width={1} height={1} depth={1}></boxGeometry>
          <standardMaterial color={cube.color}></standardMaterial>
        </mesh>
      {/snippet}

      <scene>
        {#each cubes as cube (cube.id)}
          {@render Cube(cube)}
        {/each}
      </scene>
    `);
    const root = createFragment();

    renderer.render(Scene, { target: root });

    const scene = onlyElement(root);
    const meshes = scene.children.filter((node) => node.name === 'mesh');

    expect(meshes).toHaveLength(3);
    for (const mesh of meshes) {
      expect(mesh.children.map((child) => child.name)).toEqual(['boxGeometry', 'standardMaterial']);
    }
  });

  it('renders public model nodes with url, data, and material children', () => {
    const ModelScene = compileTypeGpuSource(`
      <script>
        const data = new ArrayBuffer(8);
      </script>

      <scene>
        <model src="/models/chair.glb" position={[1, 2, 3]} rotation={[0.1, 0.2, 0.3]} scale={2}>
          <standardMaterial color={[1, 0.2, 0.1, 1]} roughness={0.8}></standardMaterial>
        </model>
        <model data={data} position={[4, 5, 6]}></model>
      </scene>
    `);
    const root = createFragment();

    renderer.render(ModelScene, {
      target: root
    });

    const scene = onlyElement(root);
    const models = scene.children.filter((node) => node.kind === 'element');
    const [srcModel, dataModel] = models;

    expect(scene.name).toBe('scene');
    expect(models).toHaveLength(2);
    expect(srcModel.name).toBe('model');
    expect(srcModel.attributes).toMatchObject({
      src: '/models/chair.glb',
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: 2
    });
    expect(srcModel.children[0]).toMatchObject({
      name: 'standardMaterial',
      attributes: {
        color: [1, 0.2, 0.1, 1],
        roughness: 0.8
      }
    });
    expect(dataModel.name).toBe('model');
    expect(dataModel.attributes).toMatchObject({
      position: [4, 5, 6]
    });
    expect(dataModel.attributes.data).toBeInstanceOf(ArrayBuffer);
  });
});

function onlyElement(root: TypeGpuNode): TypeGpuNode {
  const elements = root.children.filter((node) => node.kind === 'element');

  expect(elements).toHaveLength(1);

  return elements[0];
}

function onlyNamed(root: TypeGpuNode, name: string): TypeGpuNode {
  const match = findChild(root, name);

  expect(match).toBeTruthy();

  return match!;
}

function findChild(root: TypeGpuNode, name: string): TypeGpuNode | null {
  if (root.name === name) return root;
  for (const child of root.children) {
    const match = findChild(child, name);
    if (match) return match;
  }
  return null;
}

function compileTypeGpuSource(source: string) {
  const result = compile(source, {
    filename: 'Inline.typegpu.svelte',
    generate: 'client',
    runes: true,
    experimental: {
      customRenderer: typeGpuRendererPath
    }
  });
  const componentName = result.js.code.match(/export default function ([^(]+)/)?.[1];
  if (!componentName) throw new Error('Unable to find compiled component name');

  const executableCode = result.js.code
    .replace(`import $renderer from '${typeGpuRendererPath}';`, '')
    .replace("import 'svelte/internal/disclose-version';", '')
    .replace("import * as $ from 'svelte/internal/client';", '')
    .replace(`export default function ${componentName}`, `function ${componentName}`);

  return new Function('$', '$renderer', `${executableCode}\nreturn ${componentName};`)(
    svelteClient,
    renderer
  ) as Parameters<typeof renderer.render>[0];
}
