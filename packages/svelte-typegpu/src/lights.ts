import {
  clampedNumberArg,
  nonNegativeNumberArg,
  numberArg,
  rgbTuple,
  vectorTuple
} from './attributes';
import type { TypeGpuNode } from './core';
import { composeTransforms, IDENTITY_TRANSFORM, readLocalTransform } from './transform';
import {
  MAX_TYPEGPU_LIGHTS,
  type TypeGpuLight,
  type TypeGpuLightKind,
  type TypeGpuTransform,
  type Vector3Tuple
} from './types';
import {
  DEFAULT_LIGHT_DIRECTION,
  normalizeVector,
  rotateVectorXyz,
  subtractVectors
} from './vector-math';

export { MAX_TYPEGPU_LIGHTS };

const LIGHT_NODE_TO_KIND = new Map<string, TypeGpuLightKind>([
  ['ambientLight', 'ambient'],
  ['hemisphereLight', 'hemisphere'],
  ['directionalLight', 'directional'],
  ['pointLight', 'point'],
  ['spotLight', 'spot']
]);

const MAX_SPOT_ANGLE = Math.PI / 2 - 0.001;
const DEFAULT_SPOT_ANGLE = Math.PI / 6;
const DEFAULT_SHADOW_MAP_SIZE = 1024;
const MAX_SHADOW_MAP_SIZE = 8192;
const DEFAULT_SHADOW_BIAS = 0.0005;
const DEFAULT_SHADOW_SLOPE_BIAS = 1.5;

interface LightWalkContext {
  transform: TypeGpuTransform;
  revision: number;
}

export function collectLights(root: TypeGpuNode): TypeGpuLight[] {
  const lights: TypeGpuLight[] = [];

  collectFromNode(root, { transform: IDENTITY_TRANSFORM, revision: root.treeRevision }, lights);
  assignSupportedShadowIndices(lights);

  return lights;
}

export function isSupportedLightNode(node: TypeGpuNode | undefined): boolean {
  return Boolean(node?.name && LIGHT_NODE_TO_KIND.has(node.name));
}

export function subtreeHasSupportedLight(node: TypeGpuNode | undefined): boolean {
  if (!node) return false;
  if (isSupportedLightNode(node)) return true;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (subtreeHasSupportedLight(child)) return true;
  }

  return false;
}

function collectFromNode(
  node: TypeGpuNode,
  context: LightWalkContext,
  lights: TypeGpuLight[]
): void {
  if (lights.length >= MAX_TYPEGPU_LIGHTS || node.attributes.visible === false) return;

  let childContext = context;

  if (node.name === 'group' || node.name === 'mesh' || node.name === 'model') {
    childContext = {
      transform: composeTransforms(context.transform, readLocalTransform(node)),
      revision: combineNodeRevision(context.revision, node)
    };
  } else if (isSupportedLightNode(node)) {
    const light = readLight(node, context);
    lights.push(light);
    childContext = {
      transform: lightTransform(node, context.transform),
      revision: light.revision
    };
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectFromNode(child, childContext, lights);
    if (lights.length >= MAX_TYPEGPU_LIGHTS) return;
  }
}

function readLight(node: TypeGpuNode, context: LightWalkContext): TypeGpuLight {
  const kind = LIGHT_NODE_TO_KIND.get(node.name ?? '');
  if (!kind) throw new Error(`Unsupported light node: ${node.name ?? '<unknown>'}`);

  const transform = lightTransform(node, context.transform);
  const color =
    kind === 'hemisphere' ? rgbTuple(node.attributes.skyColor) : rgbTuple(node.attributes.color);
  const groundColor: Vector3Tuple =
    kind === 'hemisphere' ? rgbTuple(node.attributes.groundColor, [0, 0, 0]) : [0, 0, 0];

  return {
    id: node.uid,
    revision: combineNodeRevision(context.revision, node),
    kind,
    color,
    intensity: nonNegativeNumberArg(node.attributes.intensity, 1),
    position: transform.position,
    direction: readLightDirection(node, transform),
    range: nonNegativeNumberArg(node.attributes.range, 0),
    decay: nonNegativeNumberArg(node.attributes.decay, 2),
    angle: clampedNumberArg(node.attributes.angle, DEFAULT_SPOT_ANGLE, 0.001, MAX_SPOT_ANGLE),
    penumbra: clampedNumberArg(node.attributes.penumbra, 0, 0, 1),
    groundColor,
    castsShadow: node.attributes.castShadow === true,
    shadowIndex: -1,
    shadowMapSize: shadowMapSizeArg(node.attributes.shadowMapSize),
    shadowBias: numberArg(node.attributes.shadowBias, DEFAULT_SHADOW_BIAS),
    shadowSlopeBias: numberArg(node.attributes.shadowSlopeBias, DEFAULT_SHADOW_SLOPE_BIAS),
    shadowDistance: typeof node.attributes.shadowDistance === 'number' && Number.isFinite(node.attributes.shadowDistance) && node.attributes.shadowDistance > 0
      ? node.attributes.shadowDistance : undefined,
    shadowLod: node.attributes.shadowLod === true
  };
}

function assignSupportedShadowIndices(lights: TypeGpuLight[]): void {
  let nextShadowIndex = 0;

  for (const light of lights) {
    if (light.kind === 'directional' && light.castsShadow && nextShadowIndex === 0) {
      light.shadowIndex = nextShadowIndex;
      nextShadowIndex += 1;
      continue;
    }

    light.castsShadow = false;
    light.shadowIndex = -1;
  }
}

function shadowMapSizeArg(value: unknown): number {
  const size = nonNegativeNumberArg(value, DEFAULT_SHADOW_MAP_SIZE);

  if (!Number.isFinite(size) || size < 1) return DEFAULT_SHADOW_MAP_SIZE;
  return Math.max(1, Math.min(MAX_SHADOW_MAP_SIZE, Math.floor(size)));
}

function lightTransform(node: TypeGpuNode, parent: TypeGpuTransform): TypeGpuTransform {
  return composeTransforms(parent, readLocalTransform(node));
}

function readLightDirection(node: TypeGpuNode, transform: TypeGpuTransform): Vector3Tuple {
  if ('lookAt' in node.attributes) {
    return normalizeVector(
      subtractVectors(vectorTuple(node.attributes.lookAt), transform.position),
      DEFAULT_LIGHT_DIRECTION
    );
  }

  return normalizeVector(
    rotateVectorXyz(DEFAULT_LIGHT_DIRECTION, transform.rotation),
    DEFAULT_LIGHT_DIRECTION
  );
}

function combineNodeRevision(seed: number, node: TypeGpuNode | null): number {
  return node ? (seed * 31 + node.uid) * 31 + node.revision : seed * 31;
}
