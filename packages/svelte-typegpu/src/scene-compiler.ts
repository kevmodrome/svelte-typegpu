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
import { SceneRevisionCache } from './scene-revisions';
import { SceneValueCache } from './scene-value-cache';
import {
  SceneTransformCache,
  type DrawItemWalkContext,
  type SceneTransformRecord
} from './scene-transform-cache';
import { drawBatchKeysForItem } from './render-plan';
import { readInlineGeometry, readInlineMaterial } from './resources';
import {
  DEFAULT_SAMPLER,
  materialKeyFor,
  pipelineKeyFor,
  bindGroupKeyFor,
  samplerKeyFor,
  textureKeyFor
} from './material-descriptors';
import { isShaderPassFragment, normalizeShaderPassUniforms } from './shader-pass';
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
  TypeGpuShaderPass,
  TypeGpuTransform,
  Vector3Tuple
} from './types';

export interface TypeGpuSceneCache {
  drawBatchCache: TypeGpuDrawBatchCache;
  modelCache: TypeGpuModelCache;
  revisions: SceneRevisionCache;
  transforms: SceneTransformCache;
  values: SceneValueCache;
  lastState?: TypeGpuSceneState;
  cleanDrawBatches: TypeGpuDrawBatch[];
  cleanLights: TypeGpuLight[];
  cleanShaderPasses: TypeGpuShaderPass[];
  cleanInteraction: TypeGpuInteractionIndex;
  cleanResourceKeys: TypeGpuLiveResourceKeys;
  resourceItems: TypeGpuMeshDrawItem[];
  shaderPassNodes: Set<TypeGpuNode>;
  renderDefaults: Partial<TypeGpuRenderSettings>;
}

export interface CreateTypeGpuSceneCacheOptions {
  modelCache?: TypeGpuModelCache;
  onModelSettled?: () => void;
  renderDefaults?: Partial<TypeGpuRenderSettings>;
}

export interface TypeGpuSceneStateOptions {
  dirty?: Dirty;
  dirtyNodes?: ReadonlyMap<TypeGpuNode, Dirty>;
  reuseDrawBatches?: boolean;
  reuseLights?: boolean;
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
    revisions: new SceneRevisionCache(),
    transforms: new SceneTransformCache(),
    values: new SceneValueCache(),
    modelCache:
      options.modelCache ??
      createModelCache({
        onSettled: options.onModelSettled
      }),
    cleanDrawBatches: [],
    cleanLights: [],
    cleanShaderPasses: [],
    cleanInteraction: createInteractionIndex([]),
    cleanResourceKeys: createLiveResourceKeys(),
    resourceItems: [],
    shaderPassNodes: new Set(),
    renderDefaults: options.renderDefaults ?? {}
  };
}

export function createSceneState(
  root: TypeGpuNode,
  cache: TypeGpuSceneCache = createTypeGpuSceneCache(),
  options: TypeGpuSceneStateOptions = {}
): TypeGpuSceneState {
  const dirty = options.dirty ?? Dirty.All;
  const incremental =
    !options.reuseDrawBatches && !options.reuseLights
      ? updateSceneValuesAndTransforms(root, cache, dirty, options.dirtyNodes)
      : null;
  if (incremental) return (cache.lastState = incremental);
  const sceneSettings = readRenderSettings(root, cache.renderDefaults);
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

  if (recomputeShaderPasses) cache.shaderPassNodes = new Set();
  const shaderPasses = recomputeShaderPasses
    ? collectShaderPasses(root, cache.shaderPassNodes)
    : cache.cleanShaderPasses;

  if (recomputeShaderPasses) {
    cache.cleanShaderPasses = shaderPasses;
  }

  const drawBatches = recomputeDrawBatches
    ? cache.drawBatchCache.read(
        (drawItems = collectMeshDrawItems(root, cache)).filter((item) => item.visible !== false)
      )
    : cache.drawBatchCache.updateInstances([]).batches;

  if (recomputeDrawBatches) {
    cache.cleanDrawBatches = drawBatches;
    cache.resourceItems = drawItems!;
    cache.cleanResourceKeys = liveResourceKeysFor(drawItems!);
  }

  const interaction = recomputeInteraction
    ? createInteractionIndex(
        (drawItems ?? collectMeshDrawItems(root, cache)).flatMap(interactionTargetFor)
      )
    : cache.cleanInteraction;

  if (recomputeInteraction) {
    cache.cleanInteraction = interaction;
  }
  if (drawItems) cache.transforms.attachInteraction(interaction.targets);
  if (recomputeDrawBatches) cache.transforms.commit();

  return (cache.lastState = {
    dirty,
    camera: camera.settings,
    cameraNode: camera.node,
    cameraControllerNode: camera.controllerNode,
    cameraController: camera.controller,
    renderSettings: sceneSettings.renderSettings,
    lights,
    lightsChanged: recomputeLights,
    drawBatches,
    drawBatchesChanged: recomputeDrawBatches,
    resourceItems: cache.resourceItems,
    shaderPasses,
    shaderPassesChanged: recomputeShaderPasses,
    shaderPassNodes: cache.shaderPassNodes,
    interaction,
    interactionChanged: recomputeInteraction,
    liveResourceKeys: cache.cleanResourceKeys
  });
}

function updateSceneValuesAndTransforms(
  root: TypeGpuNode,
  cache: TypeGpuSceneCache,
  dirty: Dirty,
  nodes?: ReadonlyMap<TypeGpuNode, Dirty>
): TypeGpuSceneState | null {
  const allowed = Dirty.Transform | Dirty.Lights | Dirty.MaterialUniform;
  if (
    !cache.lastState ||
    !nodes?.size ||
    (dirty & ~allowed) !== 0 ||
    !cache.transforms.isReady(root)
  )
    return null;
  const transformNodes = new Map<TypeGpuNode, Dirty>();
  const valueNodes: TypeGpuNode[] = [];
  for (const [node, mask] of nodes) {
    if ((mask & ~allowed) !== 0) return null;
    if (hasDirty(mask, Dirty.MaterialUniform)) valueNodes.push(node);
    const transformMask = mask & ~Dirty.MaterialUniform;
    if (transformMask) transformNodes.set(node, transformMask);
  }
  if (
    transformNodes.size &&
    !cache.transforms.canUpdate(root, Dirty.Transform | Dirty.Lights, transformNodes)
  )
    return null;
  const prepared = cache.values.prepare(valueNodes);
  if (!prepared) return null;
  const changed = cache.transforms.update(transformNodes, cache.revisions);
  const values = cache.values.apply(prepared, cache.revisions);
  cache.drawBatchCache.updateMaterials(values.materialItems);
  const { batches, updates } = cache.drawBatchCache.updateInstances([
    ...new Set([...changed.items, ...values.instances])
  ]);
  return {
    ...cache.lastState,
    dirty,
    drawBatches: batches,
    drawBatchesChanged: false,
    instanceUpdates: updates,
    materialUpdates: values.materials,
    lightsChanged: false,
    shaderPassesChanged: false,
    interactionChanged: changed.interactionChanged
  };
}

function collectMeshDrawItems(root: TypeGpuNode, cache: TypeGpuSceneCache): TypeGpuMeshDrawItem[] {
  cache.transforms.reset(root);
  cache.values.reset();
  const items: TypeGpuMeshDrawItem[] = [];
  collectDrawItemsFromNode(
    root,
    { transform: IDENTITY_TRANSFORM, revision: 0, visible: true },
    items,
    cache
  );
  return items;
}

function collectShaderPasses(root: TypeGpuNode, nodes: Set<TypeGpuNode>): TypeGpuShaderPass[] {
  const passes: TypeGpuShaderPass[] = [];
  let sortKey = 0;

  collectShaderPassesFromNode(root, passes, () => sortKey++, nodes, true);

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
  nextSortKey: () => number,
  nodes: Set<TypeGpuNode>,
  parentVisible: boolean
): void {
  const visible = parentVisible && node.attributes.visible !== false;
  if (node.name === 'shaderPass') {
    nodes.add(node);
    const pass = readShaderPass(node, nextSortKey());
    if (pass && visible) passes.push(pass);
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectShaderPassesFromNode(child, passes, nextSortKey, nodes, visible);
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
  items: TypeGpuMeshDrawItem[],
  cache: TypeGpuSceneCache,
  parentRecord: SceneTransformRecord | null = null
): void {
  const itemStart = items.length;
  context = { ...context, visible: context.visible && node.attributes.visible !== false };
  let childContext = context;

  if (node.name === 'group') {
    childContext = {
      transform: composeTransforms(context.transform, readLocalTransform(node)),
      revision: cache.revisions.read(node, 'transform', [context.revision, node.revision]),
      visible: context.visible
    };
  } else if (node.name === 'mesh') {
    childContext = readMeshDrawItem(node, context, items, cache);
  } else if (node.name === 'model') {
    childContext = readModelDrawItems(node, context, items, cache);
  }
  const record = cache.transforms.add(node, parentRecord, childContext, items.slice(itemStart));

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectDrawItemsFromNode(child, childContext, items, cache, record);
  }
}

function readMeshDrawItem(
  mesh: TypeGpuNode,
  context: DrawItemWalkContext,
  items: TypeGpuMeshDrawItem[],
  cache: TypeGpuSceneCache
): DrawItemWalkContext {
  const revisions = cache.revisions;
  const transform = composeTransforms(context.transform, readLocalTransform(mesh));
  const meshRevision = revisions.read(mesh, 'transform', [context.revision, mesh.revision]);

  const geometry = readMeshGeometry(mesh);
  if (!geometry) {
    return { transform, revision: meshRevision, visible: context.visible };
  }

  const material = readMeshMaterial(mesh);
  const effectiveMaterial = materialForGeometry(material.value, geometry.value);
  const itemRevision = revisions.read(mesh, 'instance', [
    meshRevision,
    geometry.node,
    geometry.node?.revision,
    material.node,
    material.node?.revision
  ]);
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
    renderOrder: numberArg(mesh.attributes.renderOrder, 0),
    hitTest: hitTestMode(mesh.attributes.hitTest),
    pointerEvents: mesh.attributes.pointerEvents === 'none' ? 'none' : 'auto',
    drag: stringAttribute(mesh.attributes.drag),
    dragButton: dragButtonAttribute(mesh.attributes.dragButton),
    castShadow: castsDeclarativeShadow(mesh.attributes.castShadow, effectiveMaterial, color),
    receiveShadow: mesh.attributes.receiveShadow === true,
    visible: context.visible
  });
  cache.values.add(items[items.length - 1], material.node, () =>
    readItemValues(mesh, readMeshMaterial(mesh).value, geometry.value)
  );

  return { transform, revision: meshRevision, visible: context.visible };
}

function readMeshGeometry(mesh: TypeGpuNode): MeshResourceResult<TypeGpuGeometryData> | null {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    const geometry = readInlineGeometry(child);
    if (geometry) return { node: child, value: geometry };
  }

  return null;
}

function readMeshMaterial(mesh: TypeGpuNode): MeshResourceResult<TypeGpuMaterialDescriptor> {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    const material = readInlineMaterial(child);
    if (material) return { node: child, value: batchMaterialDescriptor(material) };
  }

  return { node: null, value: defaultMaterial() };
}

function readModelDrawItems(
  modelNode: TypeGpuNode,
  context: DrawItemWalkContext,
  items: TypeGpuMeshDrawItem[],
  cache: TypeGpuSceneCache
): DrawItemWalkContext {
  const modelTransform = composeTransforms(context.transform, readLocalTransform(modelNode));
  const modelRevision = cache.revisions.read(modelNode, 'transform', [
    context.revision,
    modelNode.revision
  ]);
  const entry = cache.modelCache.read({
    src: modelNode.attributes.src,
    data: modelNode.attributes.data
  });

  if (entry.status !== 'ready') {
    return { transform: modelTransform, revision: modelRevision, visible: context.visible };
  }

  entry.model.meshes.forEach((mesh, index) => {
    const material = readModelMaterial(modelNode, mesh);
    const transform = composeTransforms(modelTransform, mesh.transform);
    const geometry = mesh.geometry;
    const effectiveMaterial = materialForGeometry(material.value, geometry);
    const localBounds = geometry.bounds ?? defaultBounds();
    const color = rgbaArg(modelNode.attributes.color, effectiveMaterial.color);

    items.push({
      id: `model:${modelNode.uid}:primitive:${index}`,
      node: modelNode,
      revision: cache.revisions.read(modelNode, index, [
        modelRevision,
        entry,
        material.node,
        material.node?.revision
      ]),
      geometry,
      material: effectiveMaterial,
      transform,
      bounds: transformBounds(localBounds, transform),
      color,
      renderOrder: numberArg(modelNode.attributes.renderOrder, 0),
      hitTest: hitTestMode(modelNode.attributes.hitTest),
      pointerEvents: modelNode.attributes.pointerEvents === 'none' ? 'none' : 'auto',
      drag: stringAttribute(modelNode.attributes.drag),
      dragButton: dragButtonAttribute(modelNode.attributes.dragButton),
      castShadow: castsDeclarativeShadow(modelNode.attributes.castShadow, effectiveMaterial, color),
      receiveShadow: modelNode.attributes.receiveShadow === true,
      visible: context.visible
    });
    cache.transforms.setPrimitiveTransform(items[items.length - 1], mesh.transform);
    cache.values.add(items[items.length - 1], material.node, () =>
      readItemValues(modelNode, readModelMaterial(modelNode, mesh).value, geometry)
    );
  });

  return { transform: modelTransform, revision: modelRevision, visible: context.visible };
}

function readModelMaterial(
  modelNode: TypeGpuNode,
  mesh: TypeGpuLoadedModelMesh
): MeshResourceResult<TypeGpuMaterialDescriptor> {
  for (let child = modelNode.firstChild; child; child = child.nextSibling) {
    if (!modelMaterialTargetMatches(child, mesh)) continue;

    const override = readInlineMaterial(child);
    if (override) {
      return {
        node: child,
        value: batchMaterialDescriptor(mergeModelMaterial(mesh.material, override, child))
      };
    }
  }

  return { node: null, value: batchMaterialDescriptor(mesh.material) };
}

function readItemValues(
  node: TypeGpuNode,
  source: TypeGpuMaterialDescriptor,
  geometry: TypeGpuGeometryData
) {
  const material = materialForGeometry(source, geometry);
  const color = rgbaArg(node.attributes.color, material.color);
  return {
    material,
    color,
    castShadow: castsDeclarativeShadow(node.attributes.castShadow, material, color)
  };
}

function modelMaterialTargetMatches(child: TypeGpuNode, mesh: TypeGpuLoadedModelMesh): boolean {
  const target = stringAttribute(child.attributes.target);
  if (!target) return true;

  return target === mesh.name || target === mesh.geometry.key;
}

function readRenderSettings(
  root: TypeGpuNode,
  defaults: Partial<TypeGpuRenderSettings>
): {
  renderSettings: TypeGpuRenderSettings;
  activeCamera: string | null;
} {
  const scene = findScene(root);

  return {
    renderSettings: {
      clearColor: rgbaArg(
        scene?.attributes.clearColor ?? scene?.attributes.background,
        defaults.clearColor ?? [0, 0, 0, 1]
      ),
      depth:
        typeof scene?.attributes.depth === 'boolean'
          ? scene.attributes.depth
          : (defaults.depth ?? true),
      alphaMode:
        scene?.attributes.alphaMode === 'opaque' || scene?.attributes.alphaMode === 'premultiplied'
          ? scene.attributes.alphaMode
          : (defaults.alphaMode ?? 'premultiplied')
    },
    activeCamera: stringArg(scene?.attributes.activeCamera)
  };
}

function liveResourceKeysFor(items: TypeGpuMeshDrawItem[]): TypeGpuLiveResourceKeys {
  const live = createLiveResourceKeys();

  for (const item of items) {
    const batch = drawBatchKeysForItem(item);
    live.geometries.add(batch.geometryKey);
    live.materials.add(batch.materialKey);
    live.pipelines.add(batch.pipelineKey);
    live.textures.add(item.material.textureKey ?? 'solid:white');
    live.samplers.add(item.material.samplerKey ?? 'sampler:default');
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

function interactionTargetFor(item: TypeGpuMeshDrawItem): TypeGpuInteractionTarget[] {
  if (item.visible === false) return [];
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

  if (override.kind === 'shader') return override;

  merged.kind = override.kind;
  if (attrs.color !== undefined) merged.color = override.color;
  if (attrs.roughness !== undefined) merged.roughness = override.roughness;
  if (attrs.metalness !== undefined) merged.metalness = override.metalness;
  if (attrs.specularExponent !== undefined) {
    merged.specularExponent = override.specularExponent;
  }
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
    pipelineKey: pipelineKeyFor(keyed),
    bindGroupKey: bindGroupKeyFor(keyed),
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
    blendMode:
      material.blendMode ?? (material.opacity < 1 || material.color[3] < 1 ? 'alpha' : 'opaque'),
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
    bindGroupKey:
      material.bindGroupKey ?? [textureKey, samplerKeyFor(material.samplerKey)].join('|')
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

function stringArg(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
