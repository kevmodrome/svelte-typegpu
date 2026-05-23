import { numberArg } from './attributes';
import { transformBounds } from './bounds';
import { readCameraState } from './camera';
import { collectLights } from './components/lights';
import type { TypeGpuNode } from './core';
import { Dirty, hasDirty } from './dirty';
import { createDrawBatchCache, type TypeGpuDrawBatchCache } from './draw-batch-cache';
import type { TypeGpuLoadedModelMesh } from './glb-loader';
import { createModelCache, type TypeGpuModelCache } from './model-cache';
import {
  collectSceneResources,
  readInlineGeometry,
  readInlineMaterial,
  resolveGeometryReference,
  resolveMaterialReference,
  type TypeGpuResourceCollection
} from './resources';
import {
  DEFAULT_SAMPLER,
  materialKeyFor,
  samplerKeyFor,
  textureKeyFor
} from './material-descriptors';
import { composeTransforms, IDENTITY_TRANSFORM, readLocalTransform } from './transform';
import type {
  RgbaTuple,
  TypeGpuDrawBatch,
  TypeGpuGeometryData,
  TypeGpuInteractionIndex,
  TypeGpuInteractionTarget,
  TypeGpuLight,
  TypeGpuLiveResourceKeys,
  TypeGpuMaterialDescriptor,
  TypeGpuMeshDrawItem,
  TypeGpuRenderSettings,
  TypeGpuSceneState,
  TypeGpuTransform,
  Vector3Tuple
} from './types';

export interface TypeGpuSceneCache {
  drawBatchCache: TypeGpuDrawBatchCache;
  modelCache: TypeGpuModelCache;
  cleanDrawBatches: TypeGpuDrawBatch[];
  cleanLights: TypeGpuLight[];
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
  'pointerup'
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
  const camera = readCameraState(root);
  const recomputeLights = options.reuseLights === true ? false : hasDirty(dirty, Dirty.Lights);
  const recomputeDrawBatches =
    options.reuseDrawBatches === true ? false : shouldRecomputeDrawBatches(dirty);
  const recomputeInteraction = shouldRecomputeInteraction(dirty);
  let drawItems: TypeGpuMeshDrawItem[] | null = null;

  const lights = recomputeLights ? collectLights(root) : cache.cleanLights;

  if (recomputeLights) {
    cache.cleanLights = lights;
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
  const itemRevision = combineNodeRevision(
    combineNodeRevision(meshRevision, geometry.node),
    material.node
  );
  const localBounds = geometry.value.bounds ?? defaultBounds();

  items.push({
    id: mesh.uid,
    node: mesh,
    revision: itemRevision,
    geometry: geometry.value,
    material: material.value,
    transform,
    bounds: transformBounds(localBounds, transform),
    color: rgbaArg(mesh.attributes.color, material.value.color),
    phase: numberArg(mesh.attributes.phase, 0),
    spinSpeed: numberArg(mesh.attributes.spinSpeed, 0),
    renderOrder: numberArg(mesh.attributes.renderOrder, 0),
    hitTest: hitTestMode(mesh.attributes.hitTest),
    pointerEvents: mesh.attributes.pointerEvents === 'none' ? 'none' : 'auto'
  });

  return { transform, revision: meshRevision };
}

function readMeshGeometry(
  mesh: TypeGpuNode,
  resources: TypeGpuResourceCollection
): MeshResourceResult<TypeGpuGeometryData> | null {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    const geometry = readInlineGeometry(child);
    if (geometry) return { node: child, value: withGeometryShape(geometry) };
  }

  const referenced = resolveGeometryReference(mesh.attributes.geometry, resources);
  return referenced ? { node: null, value: withGeometryShape(referenced) } : null;
}

function readMeshMaterial(
  mesh: TypeGpuNode,
  resources: TypeGpuResourceCollection
): MeshResourceResult<TypeGpuMaterialDescriptor> {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    const material = readInlineMaterial(child, resources);
    if (material) return { node: child, value: batchMaterialDescriptor(material) };
  }

  const referenced = resolveMaterialReference(mesh.attributes.material, resources);
  if (referenced) return { node: null, value: batchMaterialDescriptor(referenced) };

  return { node: null, value: defaultMaterial() };
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
    const geometry = withGeometryShape(mesh.geometry);
    const localBounds = geometry.bounds ?? defaultBounds();

    items.push({
      id: `model:${modelNode.uid}:primitive:${index}`,
      node: modelNode,
      revision: combineNodeRevision(
        combineNodeRevision(modelRevision * 31 + entry.revision + index, material.node),
        null
      ),
      geometry,
      material: material.value,
      transform,
      bounds: transformBounds(localBounds, transform),
      color: rgbaArg(modelNode.attributes.color, material.value.color),
      phase: numberArg(modelNode.attributes.phase, 0),
      spinSpeed: numberArg(modelNode.attributes.spinSpeed, 0),
      renderOrder: numberArg(modelNode.attributes.renderOrder, 0),
      hitTest: hitTestMode(modelNode.attributes.hitTest),
      pointerEvents: modelNode.attributes.pointerEvents === 'none' ? 'none' : 'auto'
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
    const material = readInlineMaterial(child, resources);
    if (material) {
      return {
        node: child,
        value: batchMaterialDescriptor({
          ...mesh.material,
          ...material,
          color: child.attributes.color === undefined ? mesh.material.color : material.color,
          roughness:
            child.attributes.roughness === undefined ? mesh.material.roughness : material.roughness,
          metalness:
            child.attributes.metalness === undefined ? mesh.material.metalness : material.metalness,
          opacity: child.attributes.opacity === undefined ? mesh.material.opacity : material.opacity
        })
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
} {
  const scene = findScene(root);

  return {
    renderSettings: {
      clearColor: rgbaArg(scene?.attributes.clearColor, [0, 0, 0, 1]),
      depth: scene?.attributes.depth === false ? false : true,
      alphaMode: scene?.attributes.alphaMode === 'opaque' ? 'opaque' : 'premultiplied'
    },
    scale: numberArg(scene?.attributes.scale, 1),
    animationSpeed: numberArg(scene?.attributes.animationSpeed, 1),
    colorShift: numberArg(scene?.attributes.colorShift, 0)
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

function createInteractionIndex(targets: TypeGpuInteractionTarget[]): TypeGpuInteractionIndex {
  return {
    targets,
    pick() {
      return null;
    }
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
  if (item.pointerEvents === 'none' || item.hitTest === 'none' || !hasPointerListener(item.node)) {
    return [];
  }

  return [
    {
      id: item.id,
      drawItemId: item.id,
      node: item.node,
      bounds: item.bounds,
      hitTest: item.hitTest,
      pointerEvents: item.pointerEvents,
      renderOrder: item.renderOrder
    }
  ];
}

function hasPointerListener(node: TypeGpuNode): boolean {
  for (const type of POINTER_EVENT_TYPES) {
    if ((node.listeners.get(type)?.size ?? 0) > 0) return true;
  }

  return false;
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

function withGeometryShape(geometry: TypeGpuGeometryData): TypeGpuGeometryData {
  if (geometry.shape || !geometry.bounds) return geometry;

  return {
    ...geometry,
    shape: boundsShape(geometry.bounds)
  };
}

function boundsShape(bounds: TypeGpuGeometryData['bounds']): Vector3Tuple {
  if (!bounds) return [1, 1, 1];
  return [
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2]
  ];
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
