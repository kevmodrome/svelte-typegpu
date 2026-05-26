import { numberArg } from './attributes';
import { transformBounds } from './bounds';
import { readCameraState } from './camera';
import type { TypeGpuNode } from './core';
import { Dirty, hasDirty } from './dirty';
import { createDrawBatchCache, type TypeGpuDrawBatchCache } from './draw-batch-cache';
import type { TypeGpuLoadedModelMesh } from './glb-loader';
import { createInteractionIndex } from './interaction-index';
import { collectLights } from './lights';
import { createModelCache, type TypeGpuModelCache } from './model-cache';
import {
  collectSceneResources,
  readInlineGeometry,
  readInlineMaterial,
  resolveGeometryResourceReference,
  resolveMaterialResourceReference,
  type TypeGpuResourceCollection
} from './resources';
import {
  DEFAULT_SAMPLER,
  materialKeyFor,
  samplerKeyFor,
  textureKeyFor
} from './material-descriptors';
import { isShaderPassFragment, normalizeShaderPassUniforms } from './shader-pass';
import { composeTransforms, IDENTITY_TRANSFORM, readLocalTransform } from './transform';
import type {
  RgbaTuple,
  TypeGpuDrawBatch,
  TypeGpuGeometryData,
  TypeGpuInstanceId,
  TypeGpuInteractionIndex,
  TypeGpuInteractionTarget,
  TypeGpuLight,
  TypeGpuLiveResourceKeys,
  TypeGpuMaterialDescriptor,
  TypeGpuMeshDrawItem,
  TypeGpuRenderSettings,
  TypeGpuSceneState,
  TypeGpuShaderPass,
  TypeGpuTransform,
  Vector3Tuple
} from './types';

export interface TypeGpuSceneCache {
  drawBatchCache: TypeGpuDrawBatchCache;
  modelCache: TypeGpuModelCache;
  cleanDrawBatches: TypeGpuDrawBatch[];
  cleanLights: TypeGpuLight[];
  cleanShaderPasses: TypeGpuShaderPass[];
  cleanInteraction: TypeGpuInteractionIndex;
}

export interface CreateTypeGpuSceneCacheOptions {
  modelCache?: TypeGpuModelCache;
  onModelSettled?: () => void;
}

export interface TypeGpuSceneStateOptions {
  dirty?: Dirty;
  reuseDrawBatches?: boolean;
  reuseLights?: boolean;
}

interface DrawItemWalkContext {
  transform: TypeGpuTransform;
  revision: number;
}

interface MeshResourceResult<T> {
  node: TypeGpuNode | null;
  value: T;
}

const POINTER_EVENT_TYPES = new Set([
  'click',
  'pointermove',
  'pointerenter',
  'pointerleave',
  'pointerdown',
  'pointerup',
  'dragstart',
  'dragmove',
  'dragend'
]);

export function createTypeGpuSceneCache(
  options: CreateTypeGpuSceneCacheOptions = {}
): TypeGpuSceneCache {
  return {
    drawBatchCache: createDrawBatchCache(),
    modelCache:
      options.modelCache ??
      createModelCache({
        onSettled: options.onModelSettled
      }),
    cleanDrawBatches: [],
    cleanLights: [],
    cleanShaderPasses: [],
    cleanInteraction: createInteractionIndex([])
  };
}

export function createSceneState(
  root: TypeGpuNode,
  cache: TypeGpuSceneCache = createTypeGpuSceneCache(),
  options: TypeGpuSceneStateOptions = {}
): TypeGpuSceneState {
  const dirty = options.dirty ?? Dirty.All;
  const resources = collectSceneResources(root);
  const sceneSettings = readRenderSettings(root);
  const camera = readCameraState(root, sceneSettings.activeCamera);
  const recomputeLights = options.reuseLights === true ? false : hasDirty(dirty, Dirty.Lights);
  const recomputeShaderPasses = shouldRecomputeShaderPasses(dirty);
  const recomputeDrawBatches =
    options.reuseDrawBatches === true ? false : shouldRecomputeDrawBatches(dirty);
  const recomputeInteraction = shouldRecomputeInteraction(dirty);
  let drawItems: TypeGpuMeshDrawItem[] | null = null;

  const lights = recomputeLights ? collectLights(root) : cache.cleanLights;

  if (recomputeLights) {
    cache.cleanLights = lights;
  }

  const shaderPasses = recomputeShaderPasses ? collectShaderPasses(root) : cache.cleanShaderPasses;

  if (recomputeShaderPasses) {
    cache.cleanShaderPasses = shaderPasses;
  }

  const drawBatches = recomputeDrawBatches
    ? cache.drawBatchCache.read((drawItems = collectMeshDrawItems(root, resources, cache.modelCache)))
    : cache.cleanDrawBatches;

  if (recomputeDrawBatches) {
    cache.cleanDrawBatches = cleanDrawBatches(drawBatches);
  }

  const interaction = recomputeInteraction
    ? createInteractionIndex(
        (drawItems ?? collectMeshDrawItems(root, resources, cache.modelCache)).flatMap(
          interactionTargetFor
        )
      )
    : cache.cleanInteraction;

  if (recomputeInteraction) {
    cache.cleanInteraction = interaction;
  }

  return {
    dirty,
    camera: camera.settings,
    cameraNode: camera.node,
    cameraControllerNode: camera.controllerNode,
    cameraController: camera.controller,
    renderSettings: sceneSettings.renderSettings,
    scale: sceneSettings.scale,
    animationSpeed: sceneSettings.animationSpeed,
    colorShift: sceneSettings.colorShift,
    lights,
    lightsChanged: recomputeLights,
    drawBatches,
    drawBatchesChanged: recomputeDrawBatches,
    shaderPasses,
    shaderPassesChanged: recomputeShaderPasses,
    interaction,
    interactionChanged: recomputeInteraction,
    liveResourceKeys: liveResourceKeysFor(drawBatches)
  };
}

function collectMeshDrawItems(
  root: TypeGpuNode,
  resources: TypeGpuResourceCollection,
  modelCache: TypeGpuModelCache
): TypeGpuMeshDrawItem[] {
  const items: TypeGpuMeshDrawItem[] = [];
  collectDrawItemsFromNode(
    root,
    { transform: IDENTITY_TRANSFORM, revision: root.treeRevision },
    resources,
    items,
    modelCache
  );
  return items;
}

function collectShaderPasses(root: TypeGpuNode): TypeGpuShaderPass[] {
  const passes: TypeGpuShaderPass[] = [];
  let sortKey = 0;

  collectShaderPassesFromNode(root, passes, () => sortKey++);

  return passes.sort(
    (left, right) =>
      left.renderOrder - right.renderOrder ||
      left.sortKey - right.sortKey ||
      left.key.localeCompare(right.key)
  );
}

function collectShaderPassesFromNode(
  node: TypeGpuNode,
  passes: TypeGpuShaderPass[],
  nextSortKey: () => number
): void {
  if (node.name === 'shaderPass') {
    const pass = readShaderPass(node, nextSortKey());
    if (pass) passes.push(pass);
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectShaderPassesFromNode(child, passes, nextSortKey);
  }
}

function readShaderPass(node: TypeGpuNode, sortKey: number): TypeGpuShaderPass | null {
  if (node.attributes.active === false) return null;

  const fragment = node.attributes.fragment;
  if (!isShaderPassFragment(fragment)) return null;

  return {
    key: stringAttribute(node.attributes.id) ?? `shader-pass:${node.uid}`,
    node,
    revision: node.revision,
    fragment,
    uniforms: normalizeShaderPassUniforms(node.attributes.uniforms),
    active: true,
    renderOrder: numberArg(node.attributes.renderOrder, 0),
    sortKey
  };
}

function collectDrawItemsFromNode(
  node: TypeGpuNode,
  context: DrawItemWalkContext,
  resources: TypeGpuResourceCollection,
  items: TypeGpuMeshDrawItem[],
  modelCache: TypeGpuModelCache
): void {
  let childContext = context;

  if (node.name === 'group') {
    childContext = {
      transform: composeTransforms(context.transform, readLocalTransform(node)),
      revision: combineNodeRevision(context.revision, node)
    };
  } else if (node.name === 'mesh') {
    childContext = readMeshDrawItem(node, context, resources, items);
  } else if (node.name === 'instancedMesh') {
    childContext = readInstancedMeshDrawItems(node, context, resources, items);
  } else if (node.name === 'model') {
    childContext = readModelDrawItems(node, context, resources, items, modelCache);
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectDrawItemsFromNode(child, childContext, resources, items, modelCache);
  }
}

function readMeshDrawItem(
  mesh: TypeGpuNode,
  context: DrawItemWalkContext,
  resources: TypeGpuResourceCollection,
  items: TypeGpuMeshDrawItem[]
): DrawItemWalkContext {
  const transform = composeTransforms(context.transform, readLocalTransform(mesh));
  const meshRevision = combineNodeRevision(context.revision, mesh);

  if (mesh.attributes.visible === false) {
    return { transform, revision: meshRevision };
  }

  const geometry = readMeshGeometry(mesh, resources);
  if (!geometry) {
    return { transform, revision: meshRevision };
  }

  const material = readMeshMaterial(mesh, resources);
  const effectiveMaterial = materialForGeometry(material.value, geometry.value);
  const itemRevision = combineNodeRevision(
    combineNodeRevision(meshRevision, geometry.node),
    material.node
  );
  const localBounds = geometry.value.bounds ?? defaultBounds();
  const color = rgbaArg(mesh.attributes.color, effectiveMaterial.color);

  items.push({
    id: mesh.uid,
    node: mesh,
    revision: itemRevision,
    geometry: geometry.value,
    material: effectiveMaterial,
    transform,
    bounds: transformBounds(localBounds, transform),
    color,
    phase: numberArg(mesh.attributes.phase, 0),
    spinSpeed: numberArg(mesh.attributes.spinSpeed, 0),
    renderOrder: numberArg(mesh.attributes.renderOrder, 0),
    hitTest: hitTestMode(mesh.attributes.hitTest),
    pointerEvents: mesh.attributes.pointerEvents === 'none' ? 'none' : 'auto',
    drag: stringAttribute(mesh.attributes.drag),
    dragButton: dragButtonAttribute(mesh.attributes.dragButton),
    castShadow: castsDeclarativeShadow(mesh.attributes.castShadow, effectiveMaterial, color),
    receiveShadow: mesh.attributes.receiveShadow === true
  });

  return { transform, revision: meshRevision };
}

function readMeshGeometry(
  mesh: TypeGpuNode,
  resources: TypeGpuResourceCollection
): MeshResourceResult<TypeGpuGeometryData> | null {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    const geometry = readInlineGeometry(child);
    if (geometry) return { node: child, value: geometry };
  }

  const referenced = resolveGeometryResourceReference(mesh.attributes.geometry, resources);
  return referenced ? { node: referenced.node, value: referenced.value } : null;
}

function readMeshMaterial(
  mesh: TypeGpuNode,
  resources: TypeGpuResourceCollection
): MeshResourceResult<TypeGpuMaterialDescriptor> {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    const material = readInlineMaterial(child, resources);
    if (material) return { node: child, value: batchMaterialDescriptor(material) };
  }

  const referenced = resolveMaterialResourceReference(mesh.attributes.material, resources);
  if (referenced) {
    return { node: referenced.node, value: batchMaterialDescriptor(referenced.value) };
  }

  return { node: null, value: defaultMaterial() };
}

function readInstancedMeshDrawItems(
  instancedMesh: TypeGpuNode,
  context: DrawItemWalkContext,
  resources: TypeGpuResourceCollection,
  items: TypeGpuMeshDrawItem[]
): DrawItemWalkContext {
  const transform = composeTransforms(context.transform, readLocalTransform(instancedMesh));
  const meshRevision = combineNodeRevision(context.revision, instancedMesh);

  if (instancedMesh.attributes.visible === false) {
    return { transform, revision: meshRevision };
  }

  const instances = Array.isArray(instancedMesh.attributes.instances)
    ? instancedMesh.attributes.instances
    : [];
  if (instances.length === 0) {
    return { transform, revision: meshRevision };
  }

  const geometry = readMeshGeometry(instancedMesh, resources);
  if (!geometry) {
    return { transform, revision: meshRevision };
  }

  const material = readMeshMaterial(instancedMesh, resources);
  const effectiveMaterial = materialForGeometry(material.value, geometry.value);
  const baseRevision = combineNodeRevision(
    combineNodeRevision(meshRevision, geometry.node),
    material.node
  );
  const localBounds = geometry.value.bounds ?? defaultBounds();
  const defaultColor = rgbaArg(instancedMesh.attributes.color, effectiveMaterial.color);
  const defaultSpinSpeed = numberArg(instancedMesh.attributes.spinSpeed, 0);
  const getKey = callbackArg(instancedMesh.attributes.getKey);
  const getTransform = callbackArg(instancedMesh.attributes.getTransform);
  const getColor = callbackArg(instancedMesh.attributes.getColor);
  const getSpinSpeed = callbackArg(instancedMesh.attributes.getSpinSpeed);

  instances.forEach((instance, index) => {
    const key = readInstanceKey(getKey, instancedMesh.uid, instance, index);
    const instanceTransform = readInstanceTransform(getTransform?.(instance, index));
    const itemTransform = composeTransforms(transform, instanceTransform);
    const color = rgbaArg(getColor?.(instance, index), defaultColor);
    const spinSpeed = numberArg(getSpinSpeed?.(instance, index), defaultSpinSpeed);

    items.push({
      id: key,
      node: instancedMesh,
      revision: valueRevision(baseRevision, [
        key,
        itemTransform.position,
        itemTransform.rotation,
        itemTransform.scale,
        color,
        spinSpeed
      ]),
      geometry: geometry.value,
      material: effectiveMaterial,
      transform: itemTransform,
      bounds: transformBounds(localBounds, itemTransform),
      color,
      phase: numberArg(instancedMesh.attributes.phase, 0),
      spinSpeed,
      renderOrder: numberArg(instancedMesh.attributes.renderOrder, 0),
      hitTest: hitTestMode(instancedMesh.attributes.hitTest),
      pointerEvents: instancedMesh.attributes.pointerEvents === 'none' ? 'none' : 'auto',
      drag: stringAttribute(instancedMesh.attributes.drag),
      dragButton: dragButtonAttribute(instancedMesh.attributes.dragButton),
      castShadow: castsDeclarativeShadow(instancedMesh.attributes.castShadow, effectiveMaterial, color),
      receiveShadow: instancedMesh.attributes.receiveShadow === true
    });
  });

  return { transform, revision: meshRevision };
}

function readModelDrawItems(
  modelNode: TypeGpuNode,
  context: DrawItemWalkContext,
  resources: TypeGpuResourceCollection,
  items: TypeGpuMeshDrawItem[],
  modelCache: TypeGpuModelCache
): DrawItemWalkContext {
  const modelTransform = composeTransforms(context.transform, readLocalTransform(modelNode));
  const modelRevision = combineNodeRevision(context.revision, modelNode);
  const entry = modelCache.read({
    src: modelNode.attributes.src,
    data: modelNode.attributes.data
  });

  if (entry.status !== 'ready') {
    return { transform: modelTransform, revision: modelRevision };
  }

  entry.model.meshes.forEach((mesh, index) => {
    const material = readModelMaterial(modelNode, mesh, resources);
    const transform = composeTransforms(modelTransform, mesh.transform);
    const geometry = mesh.geometry;
    const effectiveMaterial = materialForGeometry(material.value, geometry);
    const localBounds = geometry.bounds ?? defaultBounds();
    const color = rgbaArg(modelNode.attributes.color, effectiveMaterial.color);

    items.push({
      id: `model:${modelNode.uid}:primitive:${index}`,
      node: modelNode,
      revision: combineNodeRevision(
        combineNodeRevision(modelRevision * 31 + entry.revision + index, material.node),
        null
      ),
      geometry,
      material: effectiveMaterial,
      transform,
      bounds: transformBounds(localBounds, transform),
      color,
      phase: numberArg(modelNode.attributes.phase, 0),
      spinSpeed: numberArg(modelNode.attributes.spinSpeed, 0),
      renderOrder: numberArg(modelNode.attributes.renderOrder, 0),
      hitTest: hitTestMode(modelNode.attributes.hitTest),
      pointerEvents: modelNode.attributes.pointerEvents === 'none' ? 'none' : 'auto',
      drag: stringAttribute(modelNode.attributes.drag),
      dragButton: dragButtonAttribute(modelNode.attributes.dragButton),
      castShadow: castsDeclarativeShadow(modelNode.attributes.castShadow, effectiveMaterial, color),
      receiveShadow: modelNode.attributes.receiveShadow === true
    });
  });

  return { transform: modelTransform, revision: modelRevision };
}

function readModelMaterial(
  modelNode: TypeGpuNode,
  mesh: TypeGpuLoadedModelMesh,
  resources: TypeGpuResourceCollection
): MeshResourceResult<TypeGpuMaterialDescriptor> {
  for (let child = modelNode.firstChild; child; child = child.nextSibling) {
    const override = readInlineMaterial(child, resources);
    if (override) {
      return {
        node: child,
        value: batchMaterialDescriptor(mergeModelMaterial(mesh.material, override, child))
      };
    }
  }

  return { node: null, value: batchMaterialDescriptor(mesh.material) };
}

function readRenderSettings(root: TypeGpuNode): {
  renderSettings: TypeGpuRenderSettings;
  scale: number;
  animationSpeed: number;
  colorShift: number;
  activeCamera: string | null;
} {
  const scene = findScene(root);

  return {
    renderSettings: {
      clearColor: rgbaArg(scene?.attributes.clearColor ?? scene?.attributes.background, [0, 0, 0, 1]),
      depth: scene?.attributes.depth === false ? false : true,
      alphaMode: scene?.attributes.alphaMode === 'opaque' ? 'opaque' : 'premultiplied'
    },
    scale: numberArg(scene?.attributes.scale, 1),
    animationSpeed: numberArg(scene?.attributes.animationSpeed, 1),
    colorShift: numberArg(scene?.attributes.colorShift, 0),
    activeCamera: stringArg(scene?.attributes.activeCamera)
  };
}

function liveResourceKeysFor(drawBatches: TypeGpuDrawBatch[]): TypeGpuLiveResourceKeys {
  const live = createLiveResourceKeys();

  for (const batch of drawBatches) {
    live.geometries.add(batch.geometryKey);
    live.materials.add(batch.materialKey);
    live.pipelines.add(batch.pipelineKey);
    live.textures.add(batch.material.textureKey ?? 'solid:white');
    live.samplers.add(batch.material.samplerKey ?? 'sampler:default');
  }

  return live;
}

function createLiveResourceKeys(): TypeGpuLiveResourceKeys {
  return {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
    samplers: new Set(),
    pipelines: new Set()
  };
}

function cleanDrawBatches(drawBatches: TypeGpuDrawBatch[]): TypeGpuDrawBatch[] {
  return drawBatches.map((batch) => ({
    ...batch,
    instancesChanged: false,
    dirtyRanges: []
  }));
}

function interactionTargetFor(item: TypeGpuMeshDrawItem): TypeGpuInteractionTarget[] {
  const handlers = pointerHandlersFor(item.node);

  if (item.pointerEvents === 'none' || item.hitTest === 'none' || handlers.size === 0) {
    return [];
  }

  return [
    {
      id: item.id,
      drawItemId: item.id,
      instanceId: item.id,
      node: item.node,
      bounds: item.bounds,
      hitTest: item.hitTest,
      pointerEvents: item.pointerEvents,
      handlers,
      renderOrder: item.renderOrder,
      drag: item.drag,
      dragButton: item.dragButton
    }
  ];
}

function pointerHandlersFor(node: TypeGpuNode): Set<string> {
  const handlers = new Set<string>();

  for (const type of POINTER_EVENT_TYPES) {
    if ((node.listeners.get(type)?.size ?? 0) > 0) handlers.add(type);
  }

  return handlers;
}

function shouldRecomputeDrawBatches(dirty: Dirty): boolean {
  return (
    hasDirty(dirty, Dirty.DrawBatches) ||
    hasDirty(dirty, Dirty.Geometry) ||
    hasDirty(dirty, Dirty.Material) ||
    hasDirty(dirty, Dirty.MaterialUniform) ||
    hasDirty(dirty, Dirty.Texture) ||
    hasDirty(dirty, Dirty.BindGroup) ||
    hasDirty(dirty, Dirty.Pipeline) ||
    hasDirty(dirty, Dirty.InstanceData) ||
    hasDirty(dirty, Dirty.Transform) ||
    hasDirty(dirty, Dirty.Tree)
  );
}

function shouldRecomputeInteraction(dirty: Dirty): boolean {
  return (
    hasDirty(dirty, Dirty.Interaction) ||
    hasDirty(dirty, Dirty.DrawBatches) ||
    hasDirty(dirty, Dirty.Transform) ||
    hasDirty(dirty, Dirty.InstanceData) ||
    hasDirty(dirty, Dirty.Geometry) ||
    hasDirty(dirty, Dirty.Tree)
  );
}

function shouldRecomputeShaderPasses(dirty: Dirty): boolean {
  return hasDirty(dirty, Dirty.ShaderPass) || hasDirty(dirty, Dirty.Tree);
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function dragButtonAttribute(value: unknown): 'primary' | 'middle' | 'secondary' | undefined {
  return value === 'primary' || value === 'middle' || value === 'secondary' ? value : undefined;
}

function castsDeclarativeShadow(
  requested: unknown,
  material: TypeGpuMaterialDescriptor,
  color: RgbaTuple
): boolean {
  if (requested !== true) return false;
  if (material.depthWrite === false) return false;
  if (material.transparent || material.blendMode !== 'opaque') return false;
  if (material.opacity < 1 || material.color[3] < 1 || color[3] < 1) return false;
  return true;
}

function defaultMaterial(): TypeGpuMaterialDescriptor {
  return batchMaterialDescriptor(
    readInlineMaterial({ name: 'standardMaterial', attributes: {} } as TypeGpuNode)!
  );
}

function batchMaterialDescriptor(material: TypeGpuMaterialDescriptor): TypeGpuMaterialDescriptor {
  const descriptor = ensureMaterialDescriptor(material);
  return {
    ...descriptor,
    key: `material:${descriptor.kind}`
  };
}

function mergeModelMaterial(
  base: TypeGpuMaterialDescriptor,
  override: TypeGpuMaterialDescriptor,
  node: TypeGpuNode
): TypeGpuMaterialDescriptor {
  const merged = ensureMaterialDescriptor(base);
  const attrs = node.attributes;

  merged.kind = override.kind;
  if (attrs.color !== undefined) merged.color = override.color;
  if (attrs.roughness !== undefined) merged.roughness = override.roughness;
  if (attrs.metalness !== undefined) merged.metalness = override.metalness;
  if (attrs.opacity !== undefined) merged.opacity = override.opacity;
  if (attrs.map !== undefined) {
    merged.map = override.map;
    merged.texture = override.texture;
    merged.textureKey = override.textureKey;
  }
  if (attrs.sampler !== undefined) {
    merged.sampler = override.sampler;
    merged.samplerKey = override.samplerKey;
  }
  if (attrs.transparent !== undefined) merged.transparent = override.transparent;
  if (attrs.depthWrite !== undefined) {
    merged.depthWrite = override.depthWrite;
    merged.explicitDepthWrite = override.explicitDepthWrite;
  }
  if (attrs.depthTest !== undefined) {
    merged.depthTest = override.depthTest;
    merged.explicitDepthTest = override.explicitDepthTest;
  }
  if (attrs.cullMode !== undefined) merged.cullMode = override.cullMode;
  if (attrs.blendMode !== undefined) {
    merged.blendMode = override.blendMode;
    merged.explicitBlendMode = override.explicitBlendMode;
  }

  return recomputeMaterialKeys(merged);
}

function recomputeMaterialKeys(material: TypeGpuMaterialDescriptor): TypeGpuMaterialDescriptor {
  const textureKey = material.textureKey ?? textureKeyFor(material.map);
  const samplerKey = material.samplerKey ?? DEFAULT_SAMPLER.key;
  const transparent =
    Boolean(material.transparent) || material.opacity < 1 || material.color[3] < 1;
  const blendMode = material.blendMode ?? (transparent ? 'alpha' : 'opaque');
  const depthWrite = material.depthWrite ?? !transparent;
  const depthTest = material.depthTest ?? true;
  const cullMode = material.cullMode ?? 'back';
  const keyed = {
    ...material,
    textureKey,
    samplerKey,
    transparent,
    blendMode,
    depthWrite,
    depthTest,
    cullMode
  };

  return {
    ...keyed,
    pipelineKey: [
      `material:${keyed.kind}`,
      `blend:${blendMode}`,
      `depthWrite:${depthWrite}`,
      `depthTest:${depthTest}`,
      `cull:${cullMode}`
    ].join('|'),
    bindGroupKey: [textureKey, samplerKey].join('|'),
    key: materialKeyFor(keyed)
  };
}

function materialForGeometry(
  material: TypeGpuMaterialDescriptor,
  geometry: TypeGpuGeometryData
): TypeGpuMaterialDescriptor {
  if (!geometry.hasVertexAlpha) return material;

  const adjusted = recomputeMaterialKeys({
    ...material,
    transparent: true,
    blendMode: material.explicitBlendMode ? material.blendMode : 'alpha',
    depthWrite: material.explicitDepthWrite ? material.depthWrite : false
  });

  return {
    ...adjusted,
    key: `material:${adjusted.kind}`
  };
}

function ensureMaterialDescriptor(material: TypeGpuMaterialDescriptor): TypeGpuMaterialDescriptor {
  const textureKey = material.textureKey ?? textureKeyFor(material.map);
  const samplerKey = material.samplerKey ?? DEFAULT_SAMPLER.key;
  const descriptor: TypeGpuMaterialDescriptor = {
    ...material,
    textureKey,
    samplerKey,
    transparent: Boolean(material.transparent) || material.opacity < 1 || material.color[3] < 1,
    depthWrite: material.depthWrite ?? !(material.opacity < 1 || material.color[3] < 1),
    depthTest: material.depthTest ?? true,
    cullMode: material.cullMode ?? 'back',
    blendMode: material.blendMode ?? (material.opacity < 1 || material.color[3] < 1 ? 'alpha' : 'opaque'),
    explicitBlendMode: material.explicitBlendMode ?? false,
    explicitDepthWrite: material.explicitDepthWrite ?? false,
    explicitDepthTest: material.explicitDepthTest ?? false,
    pipelineKey:
      material.pipelineKey ??
      [
        `material:${material.kind}`,
        `blend:${material.blendMode ?? (material.opacity < 1 || material.color[3] < 1 ? 'alpha' : 'opaque')}`,
        `depthWrite:${material.depthWrite ?? !(material.opacity < 1 || material.color[3] < 1)}`,
        `depthTest:${material.depthTest ?? true}`,
        `cull:${material.cullMode ?? 'back'}`
      ].join('|'),
    bindGroupKey: material.bindGroupKey ?? [textureKey, samplerKeyFor(material.samplerKey)].join('|')
  };

  return {
    ...descriptor,
    key: descriptor.key ?? materialKeyFor(descriptor)
  };
}

function hitTestMode(value: unknown): 'none' | 'bounds' | 'mesh' {
  if (value === 'none' || value === 'mesh') return value;
  return 'bounds';
}

function defaultBounds() {
  return {
    min: [-0.5, -0.5, -0.5] as Vector3Tuple,
    max: [0.5, 0.5, 0.5] as Vector3Tuple
  };
}

function rgbaArg(value: unknown, fallback: RgbaTuple): RgbaTuple {
  if (!Array.isArray(value)) return [...fallback] as RgbaTuple;

  return [
    numberArg(value[0], fallback[0]),
    numberArg(value[1], fallback[1]),
    numberArg(value[2], fallback[2]),
    numberArg(value[3], fallback[3])
  ];
}

function findScene(root: TypeGpuNode): TypeGpuNode | null {
  if (root.name === 'scene') return root;
  for (let child = root.firstChild; child; child = child.nextSibling) {
    const scene = findScene(child);
    if (scene) return scene;
  }
  return null;
}

function combineNodeRevision(seed: number, node: TypeGpuNode | null): number {
  return node ? (seed * 31 + node.uid) * 31 + node.revision : seed * 31;
}

function callbackArg(value: unknown): ((item: unknown, index: number) => unknown) | null {
  return typeof value === 'function'
    ? (value as (item: unknown, index: number) => unknown)
    : null;
}

function readInstanceKey(
  getKey: ((item: unknown, index: number) => unknown) | null,
  nodeUid: number,
  instance: unknown,
  index: number
): TypeGpuInstanceId {
  const key = getKey?.(instance, index);
  return typeof key === 'string' || typeof key === 'number' ? key : `${nodeUid}:${index}`;
}

function readInstanceTransform(value: unknown): TypeGpuTransform {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return IDENTITY_TRANSFORM;
  }

  const transform = value as Record<string, unknown>;
  return {
    position: vector3Arg(transform.position, IDENTITY_TRANSFORM.position),
    rotation: vector3Arg(transform.rotation, IDENTITY_TRANSFORM.rotation),
    scale: vector3Arg(transform.scale, IDENTITY_TRANSFORM.scale)
  };
}

function vector3Arg(value: unknown, fallback: Vector3Tuple): Vector3Tuple {
  if (!Array.isArray(value)) return [...fallback] as Vector3Tuple;

  return [
    numberArg(value[0], fallback[0]),
    numberArg(value[1], fallback[1]),
    numberArg(value[2], fallback[2])
  ];
}

function valueRevision(seed: number, values: unknown[]): number {
  let revision = seed;

  for (const value of values) {
    revision = revision * 31 + hashValue(value);
  }

  return revision;
}

function hashValue(value: unknown): number {
  if (typeof value === 'number') return hashNumber(value);
  if (typeof value === 'string') return hashString(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value)) return value.reduce((hash, item) => hash * 31 + hashValue(item), 17);
  if (!value || typeof value !== 'object') return 0;
  return hashString(String(value));
}

function hashNumber(value: number): number {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, true);

  return hashBytes(new Uint8Array(bytes));
}

function hashBytes(bytes: Uint8Array): number {
  let hash = 0;

  for (const byte of bytes) {
    hash = (hash * 31 + byte) | 0;
  }

  return hash;
}

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return hash;
}

function stringArg(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
