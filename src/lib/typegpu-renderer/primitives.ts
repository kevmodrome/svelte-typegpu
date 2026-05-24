import { Dirty, mergeDirty } from './dirty';

const aliases = new Map<string, string>([
  ['perspective-camera', 'perspectiveCamera'],
  ['orthographic-camera', 'orthographicCamera'],
  ['orbit-controls', 'orbitControls'],
  ['ambient-light', 'ambientLight'],
  ['hemisphere-light', 'hemisphereLight'],
  ['directional-light', 'directionalLight'],
  ['point-light', 'pointLight'],
  ['spot-light', 'spotLight'],
  ['instanced-mesh', 'instancedMesh'],
  ['box-geometry', 'boxGeometry'],
  ['plane-geometry', 'planeGeometry'],
  ['sphere-geometry', 'sphereGeometry'],
  ['buffer-geometry', 'bufferGeometry'],
  ['basic-material', 'basicMaterial'],
  ['phong-material', 'phongMaterial'],
  ['standard-material', 'standardMaterial']
]);

const transformAttributes = new Set(['position', 'rotation', 'scale', 'matrix']);
const sceneAttributes = new Set(['clearColor', 'background', 'activeCamera']);
const sceneUniformAttributes = new Set(['scale', 'animationSpeed', 'colorShift']);
const cameraAttributes = new Set(['id', 'active', 'position', 'target', 'fov', 'near', 'far', 'zoom']);
const controlAttributes = new Set([
  'camera',
  'enabled',
  'target',
  'minDistance',
  'maxDistance',
  'enablePan',
  'enableZoom',
  'enableRotate',
  'rotateSpeed',
  'zoomSpeed'
]);
const geometryNames = new Set(['boxGeometry', 'planeGeometry', 'sphereGeometry', 'bufferGeometry']);
const materialNames = new Set(['basicMaterial', 'phongMaterial', 'standardMaterial']);
const meshNames = new Set(['mesh', 'instancedMesh', 'model']);
const materialUniformAttributes = new Set(['color', 'opacity', 'roughness', 'metalness']);
const materialBindAttributes = new Set(['map', 'sampler']);
const materialPipelineAttributes = new Set([
  'transparent',
  'blendMode',
  'depthWrite',
  'depthTest',
  'cullMode',
  'doubleSided'
]);
const textureAttributes = new Set(['src', 'data', 'width', 'height', 'format', 'colorSpace']);
const samplerAttributes = new Set([
  'magFilter',
  'minFilter',
  'mipmapFilter',
  'addressModeU',
  'addressModeV',
  'addressModeW'
]);
const lightNames = new Set([
  'ambientLight',
  'hemisphereLight',
  'directionalLight',
  'pointLight',
  'spotLight'
]);
const cameraBridgeAttributes = new Map<string, Set<string>>([
  ['cameraPose', new Set(['position', 'target'])],
  ['cameraLens', new Set(['fov', 'near', 'far'])],
  ['controls', new Set(['mode', 'minDistance', 'maxDistance', 'invert'])],
  ['pointerControls', new Set(['dragButton', 'rotateSpeed', 'wheel', 'zoomSpeed', 'touch'])],
  [
    'keyboardControls',
    new Set([
      'rotateLeft',
      'rotateRight',
      'rotateUp',
      'rotateDown',
      'zoomIn',
      'zoomOut',
      'moveForward',
      'moveBackward',
      'moveLeft',
      'moveRight',
      'moveUp',
      'moveDown',
      'step',
      'moveStep',
      'smooth'
    ])
  ]
]);
const modelGeometryAttributes = new Set(['src', 'data']);
const instanceBatchAttributes = new Set(['instances', 'getKey']);
const instanceDataAttributes = new Set([
  'phase',
  'spinSpeed',
  'color',
  'getTransform',
  'getColor',
  'getSpinSpeed'
]);
const pointerEvents = new Set([
  'click',
  'pointermove',
  'pointerenter',
  'pointerleave',
  'pointerdown',
  'pointerup'
]);
const MAX_STABLE_TUPLE_LENGTH = 32;

export function normalizePrimitiveName(name: string): string {
  return aliases.get(name) ?? name;
}

export function dirtyForAttribute(
  nodeName: string | undefined,
  attribute: string,
  previous: unknown,
  next: unknown
): Dirty {
  if (sameAttributeValue(previous, next)) return Dirty.None;

  const name = normalizePrimitiveName(nodeName ?? '');

  if (name === 'scene') {
    if (sceneAttributes.has(attribute)) return Dirty.RenderSettings;
    if (sceneUniformAttributes.has(attribute)) return Dirty.RenderSettings;
    return Dirty.None;
  }

  if (name === 'perspectiveCamera' || name === 'orthographicCamera') {
    return cameraAttributes.has(attribute) ? Dirty.Camera : Dirty.None;
  }

  if (name === 'orbitControls') {
    return controlAttributes.has(attribute) ? Dirty.Camera : Dirty.None;
  }

  const cameraBridgeAttributeSet = cameraBridgeAttributes.get(name);
  if (cameraBridgeAttributeSet) {
    return cameraBridgeAttributeSet.has(attribute) ? Dirty.Camera : Dirty.None;
  }

  if (lightNames.has(name)) {
    return Dirty.Lights;
  }

  if (name === 'group') {
    if (transformAttributes.has(attribute)) {
      return mergeDirty(Dirty.Transform, Dirty.InstanceData, Dirty.Interaction, Dirty.Lights);
    }
    if (attribute === 'visible' || attribute === 'renderOrder') {
      return mergeDirty(Dirty.DrawBatches, Dirty.Interaction, Dirty.Lights);
    }
  }

  if (transformAttributes.has(attribute)) {
    return mergeDirty(Dirty.Transform, Dirty.InstanceData, Dirty.Interaction);
  }

  if (attribute === 'visible' || attribute === 'renderOrder') {
    return mergeDirty(Dirty.DrawBatches, Dirty.Interaction);
  }

  if (geometryNames.has(name)) {
    return mergeDirty(Dirty.Geometry, Dirty.DrawBatches, Dirty.Interaction);
  }

  if (materialNames.has(name)) {
    if (attribute === 'material') {
      return mergeDirty(
        Dirty.Material,
        Dirty.MaterialUniform,
        Dirty.Texture,
        Dirty.BindGroup,
        Dirty.Pipeline,
        Dirty.DrawBatches
      );
    }
    if (materialUniformAttributes.has(attribute)) return Dirty.MaterialUniform;
    if (materialBindAttributes.has(attribute)) {
      return mergeDirty(Dirty.Material, Dirty.Texture, Dirty.BindGroup, Dirty.DrawBatches);
    }
    if (materialPipelineAttributes.has(attribute)) {
      return mergeDirty(Dirty.Material, Dirty.Pipeline, Dirty.DrawBatches);
    }
    if (attribute === 'id') return mergeDirty(Dirty.Material, Dirty.DrawBatches);
  }

  if (name === 'texture') {
    return textureAttributes.has(attribute) || attribute === 'id'
      ? mergeDirty(Dirty.Texture, Dirty.BindGroup, Dirty.DrawBatches)
      : Dirty.None;
  }

  if (name === 'sampler') {
    return samplerAttributes.has(attribute) || attribute === 'id'
      ? mergeDirty(Dirty.Sampler, Dirty.BindGroup, Dirty.DrawBatches)
      : Dirty.None;
  }

  if (meshNames.has(name)) {
    if (name === 'model' && modelGeometryAttributes.has(attribute)) {
      return mergeDirty(Dirty.Geometry, Dirty.DrawBatches, Dirty.Interaction);
    }
    if (attribute === 'geometry' || attribute === 'material' || instanceBatchAttributes.has(attribute)) {
      return mergeDirty(Dirty.DrawBatches, Dirty.Interaction);
    }
    if (instanceDataAttributes.has(attribute)) return mergeDirty(Dirty.InstanceData, Dirty.Interaction);
    if (attribute === 'pointerEvents' || attribute === 'hitTest') return Dirty.Interaction;
  }

  return Dirty.None;
}

export function dirtyForInsert(nodeName: string | undefined): Dirty {
  return dirtyForTreeChange(nodeName);
}

export function dirtyForRemove(nodeName: string | undefined): Dirty {
  return dirtyForTreeChange(nodeName);
}

export function dirtyForEventListener(nodeName: string | undefined, eventName: string): Dirty {
  const name = normalizePrimitiveName(nodeName ?? '');

  return (name === 'mesh' || name === 'instancedMesh' || name === 'model') && pointerEvents.has(eventName)
    ? Dirty.Interaction
    : Dirty.None;
}

function dirtyForTreeChange(nodeName: string | undefined): Dirty {
  const name = normalizePrimitiveName(nodeName ?? '');

  if (name === 'scene') return Dirty.All;
  if (name === 'perspectiveCamera' || name === 'orthographicCamera' || name === 'orbitControls') {
    return mergeDirty(Dirty.Tree, Dirty.Camera);
  }
  if (cameraBridgeAttributes.has(name)) return mergeDirty(Dirty.Tree, Dirty.Camera);
  if (lightNames.has(name)) return mergeDirty(Dirty.Tree, Dirty.Lights);
  if (geometryNames.has(name)) {
    return mergeDirty(Dirty.Tree, Dirty.Geometry, Dirty.DrawBatches, Dirty.Interaction);
  }
  if (materialNames.has(name)) return mergeDirty(Dirty.Tree, Dirty.Material, Dirty.DrawBatches);
  if (name === 'texture') return mergeDirty(Dirty.Tree, Dirty.Texture, Dirty.BindGroup, Dirty.DrawBatches);
  if (name === 'sampler') return mergeDirty(Dirty.Tree, Dirty.Sampler, Dirty.BindGroup, Dirty.DrawBatches);
  if (name === 'group') return mergeDirty(Dirty.Tree, Dirty.DrawBatches, Dirty.Interaction, Dirty.Lights);
  if (name === 'mesh' || name === 'instancedMesh' || name === 'model') {
    return mergeDirty(Dirty.Tree, Dirty.DrawBatches, Dirty.Interaction);
  }

  return Dirty.Tree;
}

export function sameAttributeValue(previous: unknown, next: unknown): boolean {
  if (isStableScalar(previous) && isStableScalar(next) && Object.is(previous, next)) return true;
  if (!Array.isArray(previous) || !Array.isArray(next)) return false;
  if (Object.is(previous, next)) return true;
  if (previous.length !== next.length || previous.length > MAX_STABLE_TUPLE_LENGTH) return false;

  return previous.every(
    (value, index) =>
      isStableScalar(value) && isStableScalar(next[index]) && Object.is(value, next[index])
  );
}

function isStableScalar(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'symbol' ||
    typeof value === 'bigint'
  );
}
