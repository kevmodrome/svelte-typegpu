import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { mount, unmount, type Component } from 'svelte';
import * as svelteClient from 'svelte/internal/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
import renderer from 'svelte-typegpu';

const instances: ReturnType<typeof mount>[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => unmount(instance)));
});

const typeGpuRendererPath = fileURLToPath(
  import.meta.resolve('svelte-typegpu/svelte-renderer')
);

describe('TypeGPU demo scene authoring API', () => {
  const source = readFileSync(new URL('./Scene.typegpu.svelte', import.meta.url), 'utf8');

  it('authors the public demo around named declarative scene components', () => {
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
    expect(source).not.toContain('<resources>');
    expect(source).not.toContain('<instancedMesh');
    expect(source).not.toMatch(/\sgeometry=/);
    expect(source).not.toMatch(/\smaterial=/);
    expect(source).not.toContain('animationSpeed');
    expect(source).not.toContain('colorShift');
    expect(quadrantSource).not.toContain('<instancedMesh');
    expect(quadrantSource).toContain('{#each quadrant.instances');
    expect(quadrantSource).toContain('<boxGeometry');
    expect(quadrantSource).toContain('<phongMaterial');
    expect(quadrantSource).toContain('map="/textures/checker.svg"');
    expect(cubeSource).toContain('<mesh');
    expect(cubeSource).toContain('<boxGeometry');
    expect(cubeSource).toContain('<standardMaterial');
    expect(sphereSource).toContain('<sphereGeometry');
    expect(sphereSource).toContain('<standardMaterial');
    expect(source).not.toContain('<cameraPose');
    expect(source).not.toContain('<orbitControls');
    expect(source).not.toContain('/models/column.glb');
  });

  it('renders orbit controls, inline cube quadrants, and clickable feature meshes', () => {
    const root = createFragment();
    const Scene = loadTypeGpuSceneComponent(source);
    const onShapeClick = vi.fn();
    const onCameraChange = vi.fn();
    const controls: SceneControls = {
      ...DEFAULT_SCENE_CONTROLS,
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

    instances.push(mount(Scene, {
      renderer,
      target: root,
      props: { controls, onShapeClick, onCameraChange }
    }));

    const scene = onlyElement(root, 'scene');
    const camera = onlyNamed(scene, 'perspectiveCamera');
    const controlsNode = onlyNamed(camera, 'controls');
    const pointerControls = onlyNamed(controlsNode, 'pointerControls');
    const keyboardControls = onlyNamed(controlsNode, 'keyboardControls');
    const groups = namedChildren(scene, 'group');
    const meshes = namedChildren(scene, 'mesh');
    const quadrantMeshes = groups.flatMap((group) => namedChildren(group, 'mesh'));
    const featureMeshes = meshes.filter((mesh) => mesh.attributes.role === 'button');

    expect(scene.attributes).toMatchObject({
      clearColor: [0.067, 0.078, 0.102, 1]
    });
    expect(scene.attributes).not.toHaveProperty('scale');
    expect(scene.attributes).not.toHaveProperty('animationSpeed');
    expect(scene.attributes).not.toHaveProperty('colorShift');
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

    expect(groups).toHaveLength(4);
    expect(groups.map((group) => namedChildren(group, 'mesh').length)).toEqual([3, 3, 2, 2]);
    expect(quadrantMeshes).toHaveLength(10);
    for (const mesh of quadrantMeshes) {
      expect(onlyNamed(mesh, 'boxGeometry').attributes).toMatchObject({
        width: 1,
        height: 1,
        depth: 1
      });
      expect(onlyNamed(mesh, 'phongMaterial').attributes).toMatchObject({
        map: '/textures/checker.svg',
        sampler: { addressModeU: 'repeat', addressModeV: 'repeat' }
      });
    }

    expect(featureMeshes).toHaveLength(2);
    expect(featureMeshes[0].attributes).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change featured cube color'
    });
    expect(onlyNamed(featureMeshes[0], 'boxGeometry').attributes).toMatchObject({
      width: 1,
      height: 1,
      depth: 1
    });
    expect(onlyNamed(featureMeshes[0], 'standardMaterial').attributes).toMatchObject({
      roughness: 0.18,
      metalness: 0.28
    });
    expect(featureMeshes[1].attributes).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change featured sphere color'
    });
    expect(onlyNamed(featureMeshes[1], 'sphereGeometry').attributes.radius).toBeCloseTo(0.45);

    dispatchNodeEvent(featureMeshes[0], 'click');
    dispatchNodeEvent(featureMeshes[1], 'keydown', { key: 'Enter' } as never);
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

  it('routes scale changes through tweened scene values', () => {
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
      cubeScale: 1.9
    };

    instances.push(mount(Scene, {
      renderer,
      target: root,
      props: { controls }
    }));

    const scene = onlyElement(root, 'scene');

    const firstQuadrantMesh = namedChildren(scene, 'group')
      .flatMap((group) => namedChildren(group, 'mesh'))[0];
    const featureMesh = namedChildren(scene, 'mesh').find(
      (node) => node.attributes['aria-label'] === 'Change featured cube color'
    );

    expect(Tween.of).toHaveBeenCalledTimes(1);
    expect(scene.attributes).not.toHaveProperty('scale');
    expect(scene.attributes).not.toHaveProperty('animationSpeed');
    expect(firstQuadrantMesh.attributes.scale).toEqual([2.415, 2.415, 2.415]);
    expect(featureMesh?.attributes.scale).toEqual([
      5.313000000000001,
      3.7191,
      5.313000000000001
    ]);
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
  ) as Component<any>;
}
