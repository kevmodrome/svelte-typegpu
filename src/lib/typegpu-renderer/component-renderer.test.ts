import { compile } from 'svelte/compiler';
import * as svelteClient from 'svelte/internal/client';
import { describe, expect, it, vi } from 'vitest';
import { createFragment, type TypeGpuNode } from './core';
import renderer from './svelte-renderer';

describe('TypeGPU target primitive component rendering', () => {
  it('renders guide-level scene primitives into normalized host nodes', () => {
    const onClick = vi.fn();
    const Scene = compileTypeGpuSource(`
      <script>
        let { onClick } = $props();
        const instances = [{ id: 'a' }, { id: 'b' }];
      </script>

      <scene clearColor={[0, 0, 0, 1]}>
        <perspectiveCamera id="main" active={true} position={[0, 0, 10]} target={[0, 0, 0]} />
        <orbitControls camera="main" target={[0, 0, 0]} minDistance={2} maxDistance={40} />
        <ambientLight intensity={0.2} />
        <directionalLight position={[1, 2, 3]} />
        <resources>
          <boxGeometry id="cube" width={1} height={2} depth={3} />
          <texture id="checker" src="/textures/checker.svg" />
          <sampler id="repeatLinear" addressModeU="repeat" addressModeV="repeat" />
          <phongMaterial id="crate" map="checker" sampler="repeatLinear" color={[1, 0.8, 0.4, 1]} />
        </resources>
        <mesh geometry="cube" material="crate" position={[1, 2, 3]} onclick={onClick} />
        <instancedMesh
          geometry="cube"
          material="crate"
          instances={instances}
          getKey={(item) => item.id}
          getTransform={(item, index) => ({ position: [index, 0, 0], scale: [1, 1, 1] })}
        />
      </scene>
    `);
    const root = createFragment();

    renderer.render(Scene, { target: root, props: { onClick } });

    const scene = onlyElement(root);
    const camera = onlyNamed(scene, 'perspectiveCamera');
    const orbitControls = onlyNamed(scene, 'orbitControls');
    const resources = onlyNamed(scene, 'resources');
    const boxGeometry = onlyNamed(resources, 'boxGeometry');
    const texture = onlyNamed(resources, 'texture');
    const sampler = onlyNamed(resources, 'sampler');
    const material = onlyNamed(resources, 'phongMaterial');
    const mesh = onlyNamed(scene, 'mesh');
    const instancedMesh = onlyNamed(scene, 'instancedMesh');

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
      id: 'cube',
      width: 1,
      height: 2,
      depth: 3
    });
    expect(texture.attributes).toMatchObject({
      id: 'checker',
      src: '/textures/checker.svg'
    });
    expect(sampler.attributes).toMatchObject({
      id: 'repeatLinear',
      addressModeU: 'repeat',
      addressModeV: 'repeat'
    });
    expect(material.attributes).toMatchObject({
      id: 'crate',
      map: 'checker',
      sampler: 'repeatLinear',
      color: [1, 0.8, 0.4, 1]
    });
    expect(mesh.attributes).toMatchObject({
      geometry: 'cube',
      material: 'crate',
      position: [1, 2, 3]
    });
    expect(mesh.listeners.get('click')?.size).toBe(1);
    expect(instancedMesh.attributes).toMatchObject({
      geometry: 'cube',
      material: 'crate'
    });
    expect(instancedMesh.attributes.instances).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(
      attributeFunction<(item: { id: string }, index: number) => string>(instancedMesh, 'getKey')(
        { id: 'a' },
        0
      )
    ).toBe('a');
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

function attributeFunction<T extends (...args: any[]) => unknown>(
  node: TypeGpuNode,
  name: string
): T {
  const value = node.attributes[name];

  expect(typeof value).toBe('function');

  return value as T;
}

function compileTypeGpuSource(source: string) {
  const result = compile(source, {
    filename: 'Inline.typegpu.svelte',
    generate: 'client',
    runes: true,
    experimental: {
      customRenderer: '/src/lib/typegpu-renderer/svelte-renderer.ts'
    }
  });
  const componentName = result.js.code.match(/export default function ([^(]+)/)?.[1];
  if (!componentName) throw new Error('Unable to find compiled component name');

  const executableCode = result.js.code
    .replace("import $renderer from '/src/lib/typegpu-renderer/svelte-renderer.ts';", '')
    .replace("import 'svelte/internal/disclose-version';", '')
    .replace("import * as $ from 'svelte/internal/client';", '')
    .replace(`export default function ${componentName}`, `function ${componentName}`);

  return new Function('$', '$renderer', `${executableCode}\nreturn ${componentName};`)(
    svelteClient,
    renderer
  ) as Parameters<typeof renderer.render>[0];
}
