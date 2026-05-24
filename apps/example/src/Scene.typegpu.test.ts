import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import * as svelteClient from 'svelte/internal/client';
import { describe, expect, it, vi } from 'vitest';
import { sceneCameraForCount } from './lib/cube-field';
import { createCubeQuadrants } from './lib/cube-quadrants';
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
} from 'svelte-typegpu/testing';
import renderer, { type Vector3Tuple } from 'svelte-typegpu';

const typeGpuRendererPath = fileURLToPath(
  new URL('../../../packages/svelte-typegpu/src/svelte-renderer.ts', import.meta.url)
);

describe('TypeGPU demo scene authoring API', () => {
  const source = readFileSync(new URL('./Scene.typegpu.svelte', import.meta.url), 'utf8');

  it('authors the public demo around named scene components and reusable resources', () => {
    const quadrantSource = readFileSync(new URL('./Quadrant.typegpu.svelte', import.meta.url), 'utf8');
    const cubeSource = readFileSync(new URL('./Cube.typegpu.svelte', import.meta.url), 'utf8');
    const sphereSource = readFileSync(new URL('./FeatureSphere.typegpu.svelte', import.meta.url), 'utf8');

    expect(source).toContain("import Quadrant from './Quadrant.typegpu.svelte'");
    expect(source).toContain("import Cube from './Cube.typegpu.svelte'");
    expect(source).toContain("import FeatureSphere from './FeatureSphere.typegpu.svelte'");
    expect(source).toContain('<Quadrant');
    expect(source).toContain('<Cube');
    expect(source).toContain('<FeatureSphere');
    expect(source).not.toMatch(/from\s+['"].\/(?:Box|Sphere)\.typegpu\.svelte['"]/);
    expect(source).not.toMatch(/<\/?(?:Box|Sphere)\b/);
    expect(source).toContain('<perspectiveCamera');
    expect(source).toContain('<controls');
    expect(source).toContain('<pointerControls');
    expect(source).toContain('<keyboardControls');
    expect(source).toContain('<resources>');
    expect(source).toContain('<boxGeometry id="cube"');
    expect(source).toContain('<texture id="checker"');
    expect(source).toContain('<sampler id="repeatLinear"');
    expect(source).toMatch(/<phongMaterial[\s\S]*id="fieldMaterial"/);
    expect(quadrantSource).toContain('<instancedMesh');
    expect(cubeSource).toContain('<mesh');
    expect(sphereSource).toContain('<sphereGeometry');
    expect(source).not.toContain('<cameraPose');
    expect(source).not.toContain('<orbitControls');
    expect(source).not.toContain('/models/column.glb');
  });

  it('renders resources, orbit controls, instanced cube quadrants, and clickable feature meshes', () => {
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
    const controlsNode = onlyNamed(camera, 'controls');
    const pointerControls = onlyNamed(controlsNode, 'pointerControls');
    const keyboardControls = onlyNamed(controlsNode, 'keyboardControls');
    const resources = onlyNamed(scene, 'resources');
    const boxGeometry = onlyNamed(resources, 'boxGeometry');
    const texture = onlyNamed(resources, 'texture');
    const sampler = onlyNamed(resources, 'sampler');
    const fieldMaterial = onlyNamed(resources, 'phongMaterial');
    const featureMaterial = onlyNamed(resources, 'standardMaterial');
    const instancedMeshes = namedChildren(scene, 'instancedMesh');
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
    expect(controlsNode.attributes).toMatchObject({
      mode: 'fly',
      minDistance: 1,
      maxDistance: 100
    });
    expect(pointerControls.attributes).toMatchObject({
      rotateSpeed: 1.75
    });
    expect(keyboardControls.attributes).toMatchObject({
      rotateLeft: 'ArrowLeft',
      rotateRight: 'ArrowRight',
      rotateUp: 'ArrowUp',
      rotateDown: 'ArrowDown',
      zoomIn: '+',
      zoomOut: '-',
      moveForward: 'KeyW',
      moveBackward: 'KeyS',
      moveLeft: 'KeyA',
      moveRight: 'KeyD',
      moveUp: 'Space',
      moveDown: 'KeyC',
      step: 0.08,
      moveStep: 0.35,
      smooth: true
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

    expect(instancedMeshes).toHaveLength(4);
    expect(instancedMeshes.map((mesh) => mesh.attributes.instances)).toHaveLength(4);
    expect(instancedMeshes.map((mesh) => (mesh.attributes.instances as unknown[]).length)).toEqual([
      3, 3, 2, 2
    ]);
    expect(
      instancedMeshes.reduce(
        (total, mesh) => total + (mesh.attributes.instances as unknown[]).length,
        0
      )
    ).toBe(10);
    expect(instancedMeshes.map((mesh) => mesh.attributes.spinSpeed)).toEqual([
      0.35, 0.8, 1.25, 1.75
    ]);
    expect(instancedMeshes.map((mesh) => mesh.attributes.scale)).toEqual([0.7, 0.9, 1.1, 1.3]);
    expect(instancedMeshes.map((mesh) => mesh.attributes.phase)).toEqual([0, 0.7, 1.4, 2.1]);
    expect((instancedMeshes[0].attributes.position as Vector3Tuple)[0]).toBeLessThan(0);
    expect((instancedMeshes[0].attributes.position as Vector3Tuple)[2]).toBeLessThan(0);
    expect((instancedMeshes[3].attributes.position as Vector3Tuple)[0]).toBeGreaterThan(0);
    expect((instancedMeshes[3].attributes.position as Vector3Tuple)[2]).toBeGreaterThan(0);

    const firstQuadrant = instancedMeshes[0];
    expect(firstQuadrant.attributes).toMatchObject({
      geometry: 'cube',
      material: 'fieldMaterial'
    });
    expect(
      attributeFunction<(box: { id: number }, index: number) => number>(firstQuadrant, 'getKey')(
        { id: 4 },
        4
      )
    ).toBe(4);
    expect(
      attributeFunction<
        (box: { position: [number, number, number] }, index: number) => {
          position: [number, number, number];
          scale: [number, number, number];
        }
      >(firstQuadrant, 'getTransform')({ position: [1, 2, 3] }, 0)
    ).toMatchObject({
      position: [1, 2, 3],
      scale: [0.24, 0.24, 0.24]
    });
    expect(
      attributeFunction<(box: { id: number; colorOffset: number }, index: number) => unknown>(
        firstQuadrant,
        'getColor'
      )({ id: 0, colorOffset: 0 }, 0)
    ).toEqual(demoColorForIndex(0, 0));

    expect(meshes).toHaveLength(2);
    expect(meshes[0].attributes).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change featured cube color',
      geometry: 'cube',
      material: 'featureMaterial',
      spinSpeed: 1.35
    });
    expect(meshes[1].attributes).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change featured sphere color',
      spinSpeed: 1.7
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
    dispatchNodeEvent(controlsNode, 'camerachange', { detail: cameraChange });

    expect(onShapeClick).toHaveBeenCalledTimes(2);
    expect(onCameraChange).toHaveBeenCalledWith(cameraChange);
  });

  it('routes pause and scale changes through tweened scene values', () => {
    const root = createFragment();
    const Tween = {
      of: vi.fn((readTarget: () => number) => ({
        get current() {
          const target = readTarget();

          if (target === 0) return 0.37;
          if (target === 1.9) return 1.61;

          return target;
        }
      }))
    };
    const Scene = loadTypeGpuSceneComponent(source, { Tween });
    const controls: SceneControls = {
      ...DEFAULT_SCENE_CONTROLS,
      spinEnabled: false,
      spinSpeed: 1.5,
      cubeScale: 1.9
    };

    renderer.render(Scene, {
      target: root,
      props: { controls }
    });

    const scene = onlyElement(root, 'scene');

    expect(Tween.of).toHaveBeenCalledTimes(2);
    expect(scene.attributes).toMatchObject({
      scale: 1.61,
      animationSpeed: 0.37
    });
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

function loadTypeGpuSceneComponent(source: string, dependencies: Record<string, unknown> = {}) {
  const Quadrant = loadTypeGpuComponent(
    fileURLToPath(new URL('./Quadrant.typegpu.svelte', import.meta.url))
  );
  const Cube = loadTypeGpuComponent(
    fileURLToPath(new URL('./Cube.typegpu.svelte', import.meta.url))
  );
  const FeatureSphere = loadTypeGpuComponent(
    fileURLToPath(new URL('./FeatureSphere.typegpu.svelte', import.meta.url))
  );

  return loadTypeGpuComponent(fileURLToPath(new URL('./Scene.typegpu.svelte', import.meta.url)), source, {
    Cube,
    FeatureSphere,
    Quadrant,
    Tween: createImmediateTweenApi(),
    prefersReducedMotion: { current: false },
    sineInOut: (time: number) => time,
    createCubeQuadrants,
    sceneCameraForCount,
    demoColorForIndex,
    ...dependencies
  });
}

function createImmediateTweenApi() {
  return {
    of: (readTarget: () => number) => ({
      get current() {
        return readTarget();
      }
    })
  };
}

function loadTypeGpuComponent(
  filename: string,
  source = readFileSync(filename, 'utf8'),
  dependencies: Record<string, unknown> = {}
) {
  const result = compile(source, {
    filename,
    generate: 'client',
    runes: true,
    experimental: {
      customRenderer: typeGpuRendererPath
    }
  });
  const componentName = result.js.code.match(/export default function ([^(]+)/)?.[1];
  if (!componentName) throw new Error(`Unable to find compiled component name for ${filename}`);

  const executableCode = result.js.code
    .replace(/^import .*;\n/gm, '')
    .replace(`export default function ${componentName}`, `function ${componentName}`);
  const dependencyNames = Object.keys(dependencies);
  const createComponent = new Function(
    '$',
    '$renderer',
    ...dependencyNames,
    `${executableCode}\nreturn ${componentName};`
  );

  return createComponent(
    svelteClient,
    renderer,
    ...dependencyNames.map((name) => dependencies[name])
  ) as Parameters<typeof renderer.render>[0];
}
