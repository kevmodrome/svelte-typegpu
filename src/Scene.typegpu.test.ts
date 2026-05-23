import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import * as svelteClient from 'svelte/internal/client';
import { describe, expect, it, vi } from 'vitest';
import { createCubeField, sceneCameraForCount } from './lib/cube-field';
import { demoColorForIndex } from './lib/demo-colors';
import {
  DEFAULT_SCENE_CONTROLS,
  type CameraChangeDetail,
  type SceneControls
} from './lib/scene-controls';
import {
  createFragment,
  dispatchNodeEvent,
  walk,
  type TypeGpuNode
} from './lib/typegpu-renderer/core';
import renderer from './lib/typegpu-renderer/svelte-renderer';

describe('TypeGPU demo scene authoring API', () => {
  const source = readFileSync('src/Scene.typegpu.svelte', 'utf8');

  it('authors the public demo around target primitives and reusable resources', () => {
    expect(source).not.toMatch(/from\s+['"].\/(?:Box|Sphere)\.typegpu\.svelte['"]/);
    expect(source).not.toMatch(/<\/?(?:Box|Sphere)\b/);
    expect(source).toContain('<perspectiveCamera');
    expect(source).toContain('<orbitControls');
    expect(source).toContain('<resources>');
    expect(source).toContain('<boxGeometry id="cube"');
    expect(source).toContain('<texture id="checker"');
    expect(source).toContain('<sampler id="repeatLinear"');
    expect(source).toMatch(/<phongMaterial[\s\S]*id="fieldMaterial"/);
    expect(source).toContain('<instancedMesh');
    expect(source).not.toContain('<cameraPose');
    expect(source).not.toContain('<controls');
    expect(source).not.toContain('/models/column.glb');
  });

  it('renders resources, orbit controls, one instanced cube field, and clickable feature meshes', () => {
    const root = createFragment();
    const Scene = loadTypeGpuSceneComponent(source);
    const onShapeClick = vi.fn();
    const onCameraChange = vi.fn();
    const controls: SceneControls = {
      ...DEFAULT_SCENE_CONTROLS,
      spinSpeed: 1.25,
      cubeScale: 1.35,
      cubeCount: 10,
      hue: 120,
      mouseSensitivity: 1.75,
      camera: {
        ...DEFAULT_SCENE_CONTROLS.camera,
        position: [9, 7, 13],
        target: [0.5, 0.25, -0.5]
      }
    };

    renderer.render(Scene, {
      target: root,
      props: { controls, onShapeClick, onCameraChange }
    });

    const scene = onlyElement(root, 'scene');
    const camera = onlyNamed(scene, 'perspectiveCamera');
    const orbitControls = onlyNamed(scene, 'orbitControls');
    const resources = onlyNamed(scene, 'resources');
    const boxGeometry = onlyNamed(resources, 'boxGeometry');
    const texture = onlyNamed(resources, 'texture');
    const sampler = onlyNamed(resources, 'sampler');
    const fieldMaterial = onlyNamed(resources, 'phongMaterial');
    const featureMaterial = onlyNamed(resources, 'standardMaterial');
    const instancedMesh = onlyNamed(scene, 'instancedMesh');
    const meshes = namedChildren(scene, 'mesh');

    expect(scene.attributes).toMatchObject({
      scale: 1.35,
      animationSpeed: 1.25,
      colorShift: 120,
      clearColor: [0.067, 0.078, 0.102, 1]
    });
    expect(camera.attributes).toMatchObject({
      id: 'main',
      active: true,
      position: controls.camera.position,
      target: controls.camera.target,
      fov: controls.camera.fov,
      near: controls.camera.near,
      far: controls.camera.far
    });
    expect(orbitControls.attributes).toMatchObject({
      camera: 'main',
      target: controls.camera.target,
      minDistance: 1,
      maxDistance: 100,
      rotateSpeed: 1.75
    });

    expect(boxGeometry.attributes).toMatchObject({
      id: 'cube',
      width: 1,
      height: 1,
      depth: 1
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
    expect(fieldMaterial.attributes).toMatchObject({
      id: 'fieldMaterial',
      map: 'checker',
      sampler: 'repeatLinear'
    });
    expect(featureMaterial.attributes).toMatchObject({
      id: 'featureMaterial',
      roughness: 0.18,
      metalness: 0.28
    });

    expect(instancedMesh.attributes).toMatchObject({
      geometry: 'cube',
      material: 'fieldMaterial',
      phase: 0,
      spinSpeed: 1.25
    });
    expect(instancedMesh.attributes.instances).toHaveLength(10);
    expect(attributeFunction<(box: { id: number }, index: number) => number>(instancedMesh, 'getKey')(
      { id: 4 },
      4
    )).toBe(4);
    expect(
      attributeFunction<
        (box: { position: [number, number, number] }, index: number) => {
          position: [number, number, number];
          scale: [number, number, number];
        }
      >(instancedMesh, 'getTransform')({ position: [1, 2, 3] }, 0)
    ).toMatchObject({
      position: [1, 2, 3],
      scale: [0.24, 0.24, 0.24]
    });
    expect(attributeFunction<(box: { id: number }, index: number) => unknown>(instancedMesh, 'getColor')(
      { id: 0 },
      0
    )).toEqual(demoColorForIndex(0, 0));

    expect(meshes).toHaveLength(2);
    expect(meshes[0].attributes).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change featured cube color',
      geometry: 'cube',
      material: 'featureMaterial'
    });
    expect(meshes[1].attributes).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change featured sphere color'
    });
    expect(onlyNamed(meshes[1], 'sphereGeometry').attributes.radius).toBeCloseTo(0.45);

    dispatchNodeEvent(meshes[0], 'click');
    dispatchNodeEvent(meshes[1], 'keydown', { key: 'Enter' } as never);
    const cameraChange: CameraChangeDetail = {
      camera: {
        position: [2, 3, 4],
        target: [0, 0, 0],
        fov: 50,
        near: 0.2,
        far: 400
      },
      orbit: {
        radius: 6,
        yaw: 0.25,
        pitch: 0.1
      }
    };
    dispatchNodeEvent(orbitControls, 'camerachange', { detail: cameraChange });

    expect(onShapeClick).toHaveBeenCalledTimes(2);
    expect(onCameraChange).toHaveBeenCalledWith(cameraChange);
  });
});

function onlyElement(root: TypeGpuNode, name: string): TypeGpuNode {
  const elements = root.children.filter((node) => node.kind === 'element');

  expect(elements).toHaveLength(1);
  expect(elements[0].name).toBe(name);

  return elements[0];
}

function onlyNamed(root: TypeGpuNode, name: string): TypeGpuNode {
  const matches = namedChildren(root, name);

  expect(matches).toHaveLength(1);

  return matches[0];
}

function namedChildren(root: TypeGpuNode, name: string): TypeGpuNode[] {
  const matches: TypeGpuNode[] = [];

  walk(root, (node) => {
    if (node.name === name) {
      matches.push(node);
    }
  });

  return matches;
}

function attributeFunction<T extends (...args: any[]) => unknown>(
  node: TypeGpuNode,
  name: string
): T {
  const value = node.attributes[name];

  expect(typeof value).toBe('function');

  return value as T;
}

function loadTypeGpuSceneComponent(source: string) {
  const result = compile(source, {
    filename: 'src/Scene.typegpu.svelte',
    generate: 'client',
    runes: true,
    experimental: {
      customRenderer: '/src/lib/typegpu-renderer/svelte-renderer.ts'
    }
  });
  const componentName = result.js.code.match(/export default function ([^(]+)/)?.[1];
  if (!componentName) throw new Error('Unable to find compiled Scene component name');

  const executableCode = result.js.code
    .replace(/^import .*;\n/gm, '')
    .replace(`export default function ${componentName}`, `function ${componentName}`);
  const createComponent = new Function(
    '$',
    '$renderer',
    'createCubeField',
    'sceneCameraForCount',
    'demoColorForIndex',
    `${executableCode}\nreturn ${componentName};`
  );

  return createComponent(
    svelteClient,
    renderer,
    createCubeField,
    sceneCameraForCount,
    demoColorForIndex
  ) as Parameters<typeof renderer.render>[0];
}
