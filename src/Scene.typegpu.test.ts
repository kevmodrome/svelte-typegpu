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

  it('authors meshes directly instead of using compatibility shape components', () => {
    expect(source).not.toMatch(/from\s+['"].\/(?:Box|Sphere)\.typegpu\.svelte['"]/);
    expect(source).not.toMatch(/<\/?(?:Box|Sphere)\b/);
    expect(source).toContain('<mesh');
    expect(source).toContain('<boxGeometry');
    expect(source).toContain('<sphereGeometry');
    expect(source).toContain('<standardMaterial');
  });

  it('keeps demo hue changes out of per-instance material props', () => {
    expect(source).toContain('colorShift={controls.hue}');
    expect(source).toContain('demoColorForIndex(index, 0)');
    expect(source).toContain('demoColorForIndex(index + 7, 28)');
    expect(source).toContain('/textures/checker.svg');
    expect(source).not.toContain('demoColorForIndex(index, controls.hue)');
    expect(source).not.toContain('demoColorForIndex(index + 7, controls.hue + 28)');
  });

  it('authors broad light nodes in the demo scene', () => {
    expect(source).toContain('<ambientLight');
    expect(source).toContain('<hemisphereLight');
    expect(source).toContain('<directionalLight');
    expect(source).toContain('<pointLight');
    expect(source).toContain('<spotLight');
    expect(source).toContain('lookAt={[0, 0, 0]}');
  });

  it('renders the direct mesh API into TypeGPU scene nodes', () => {
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
    const pose = onlyNamed(camera, 'cameraPose');
    const lens = onlyNamed(camera, 'cameraLens');
    const cameraControls = onlyNamed(camera, 'controls');
    const pointer = onlyNamed(cameraControls, 'pointerControls');
    const keyboard = onlyNamed(cameraControls, 'keyboardControls');
    const ambientLight = onlyNamed(scene, 'ambientLight');
    const hemisphereLight = onlyNamed(scene, 'hemisphereLight');
    const directionalLight = onlyNamed(scene, 'directionalLight');
    const pointLight = onlyNamed(scene, 'pointLight');
    const spotLight = onlyNamed(scene, 'spotLight');
    const meshes = namedChildren(scene, 'mesh');
    const boxMesh = meshes[0];
    const laterBoxMesh = meshes[1];
    const sphereMesh = meshes[5];

    expect(scene.attributes).toMatchObject({
      scale: 1.35,
      animationSpeed: 1.25,
      colorShift: 120
    });
    expect(camera.attributes).toEqual({});
    expect(pose.attributes).toMatchObject({
      position: controls.camera.position,
      target: controls.camera.target
    });
    expect(lens.attributes).toMatchObject({
      fov: controls.camera.fov,
      near: controls.camera.near,
      far: controls.camera.far
    });
    expect(cameraControls.attributes).toMatchObject({
      mode: 'fly',
      minDistance: 1,
      maxDistance: 100
    });
    expect(pointer.name).toBe('pointerControls');
    expect(keyboard.attributes).toMatchObject({
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
      moveStep: 0.35,
      smooth: true
    });

    expect(ambientLight.attributes).toMatchObject({ intensity: 0.18 });
    expect(hemisphereLight.attributes).toMatchObject({ intensity: 0.38 });
    expect(directionalLight.attributes).toMatchObject({ intensity: 1.45 });
    expect(pointLight.attributes).toMatchObject({ intensity: 5.5, range: 16, decay: 2 });
    expect(spotLight.attributes).toMatchObject({
      lookAt: [0, 0, 0],
      intensity: 7,
      range: 22,
      angle: 0.42,
      penumbra: 0.35
    });

    expect(meshes).toHaveLength(10);
    expect(boxMesh.attributes).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change box color',
      spinSpeed: 0.35
    });
    expect(sphereMesh.attributes).toMatchObject({
      role: 'button',
      tabindex: '0',
      'aria-label': 'Change sphere color',
      spinSpeed: 0.55
    });

    const boxGeometry = onlyNamed(boxMesh, 'boxGeometry');
    const boxMaterial = onlyNamed(boxMesh, 'standardMaterial');
    const laterBoxMaterial = onlyNamed(laterBoxMesh, 'standardMaterial');
    const sphereGeometry = onlyNamed(sphereMesh, 'sphereGeometry');
    const sphereMaterial = onlyNamed(sphereMesh, 'standardMaterial');

    expect(boxGeometry.attributes).toMatchObject({
      width: 0.432,
      height: 0.132,
      depth: 0.348
    });
    expect(boxMaterial.attributes).toMatchObject({
      map: '/textures/checker.svg',
      roughness: 0.62,
      metalness: 0.04
    });
    expect(laterBoxMaterial.attributes.map).toBeUndefined();
    expectNumberAttribute(sphereGeometry, 'radius', 0.138);
    expectNumberAttribute(sphereGeometry, 'width', 0.276);
    expectNumberAttribute(sphereGeometry, 'height', 0.276);
    expectNumberAttribute(sphereGeometry, 'depth', 0.276);
    expect(sphereMaterial.attributes).toMatchObject({
      roughness: 0.18,
      metalness: 0.28
    });

    dispatchNodeEvent(boxMesh, 'click');
    dispatchNodeEvent(sphereMesh, 'keydown', { key: 'Enter' } as never);
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
    dispatchNodeEvent(cameraControls, 'camerachange', { detail: cameraChange });

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

function expectNumberAttribute(node: TypeGpuNode, name: string, expected: number): void {
  expect(Number(node.attributes[name])).toBeCloseTo(expected);
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
