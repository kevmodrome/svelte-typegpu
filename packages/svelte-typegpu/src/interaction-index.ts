import { rayIntersectsBounds } from './bounds';
import { cameraRayFromViewport } from './camera';
import type {
  TypeGpuInteractionHit,
  TypeGpuInteractionIndex,
  TypeGpuInteractionPickInput,
  TypeGpuInteractionTarget
} from './types';

export function createInteractionIndex(
  targets: TypeGpuInteractionTarget[]
): TypeGpuInteractionIndex {
  const filtered = targets.filter(
    (target) => target.pointerEvents !== 'none' && target.hitTest !== 'none'
  );

  return {
    targets: filtered,
    pick(input: TypeGpuInteractionPickInput): TypeGpuInteractionHit | null {
      const ray = cameraRayFromViewport(input);
      let nearest: TypeGpuInteractionHit | null = null;
      let nearestRenderOrder = -Infinity;
      let nearestIndex = Number.MAX_SAFE_INTEGER;

      filtered.forEach((target, index) => {
        if (input.type && !target.handlers.has(input.type)) return;

        const hit = rayIntersectsBounds(ray, target.bounds);
        if (!hit) return;

        const renderOrder = target.renderOrder ?? 0;
        if (
          nearest &&
          (hit.distance > nearest.distance ||
            (hit.distance === nearest.distance &&
              (renderOrder < nearestRenderOrder ||
                (renderOrder === nearestRenderOrder && index > nearestIndex))))
        ) {
          return;
        }

        nearest = {
          target,
          node: target.node,
          instanceId: target.instanceId,
          distance: hit.distance,
          point: hit.point
        };
        nearestRenderOrder = renderOrder;
        nearestIndex = index;
      });

      return nearest;
    }
  };
}
