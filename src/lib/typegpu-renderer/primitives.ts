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
const pointerEvents = new Set([
  'click',
  'pointermove',
  'pointerenter',
  'pointerleave',
  'pointerdown',
  'pointerup'
]);

export function normalizePrimitiveName(name: string): string {
  return aliases.get(name) ?? name;
}

export function dirtyForAttribute(
  nodeName: string | undefined,
  attribute: string,
  previous: unknown,
  next: unknown
): Dirty {
  if (Object.is(previous, next)) return Dirty.None;

  const name = normalizePrimitiveName(nodeName ?? '');

  if (name === 'scene') {
    if (sceneAttributes.has(attribute)) return Dirty.RenderSettings;
    if (sceneUniformAttributes.has(attribute)) return Dirty.InstanceData;
    return Dirty.None;
  }

  if (transformAttributes.has(attribute)) {
    return mergeDirty(Dirty.Transform, Dirty.InstanceData, Dirty.Interaction);
  }

  if (attribute === 'visible' || attribute === 'renderOrder') {
    return mergeDirty(Dirty.DrawBatches, Dirty.Interaction);
  }

  if (name === 'perspectiveCamera' || name === 'orthographicCamera') {
    return cameraAttributes.has(attribute) ? Dirty.Camera : Dirty.None;
  }

  if (name === 'orbitControls') {
    return controlAttributes.has(attribute) ? Dirty.Camera : Dirty.None;
  }

  if (lightNames.has(name)) {
    return Dirty.Lights;
  }

  if (geometryNames.has(name)) {
    return mergeDirty(Dirty.Geometry, Dirty.DrawBatches, Dirty.Interaction);
  }

  if (materialNames.has(name)) {
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

  if (name === 'mesh' || name === 'instancedMesh' || name === 'model') {
    if (attribute === 'geometry' || attribute === 'material' || attribute === 'instances') {
      return mergeDirty(Dirty.DrawBatches, Dirty.Interaction);
    }
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
  if (lightNames.has(name)) return mergeDirty(Dirty.Tree, Dirty.Lights);
  if (geometryNames.has(name)) {
    return mergeDirty(Dirty.Tree, Dirty.Geometry, Dirty.DrawBatches, Dirty.Interaction);
  }
  if (materialNames.has(name)) return mergeDirty(Dirty.Tree, Dirty.Material, Dirty.DrawBatches);
  if (name === 'texture') return mergeDirty(Dirty.Tree, Dirty.Texture, Dirty.BindGroup, Dirty.DrawBatches);
  if (name === 'sampler') return mergeDirty(Dirty.Tree, Dirty.BindGroup, Dirty.DrawBatches);
  if (name === 'mesh' || name === 'instancedMesh' || name === 'model' || name === 'group') {
    return mergeDirty(Dirty.Tree, Dirty.DrawBatches, Dirty.Interaction);
  }

  return Dirty.Tree;
}
