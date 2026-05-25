import type { TypeGpuDragEventDetail, Vector3Tuple } from 'svelte-typegpu';

const BOX_DRAG_ROTATION_SENSITIVITY = 0.003;

export function rotateBoxesFromDrag(
  rotation: Vector3Tuple,
  event: { detail: Pick<TypeGpuDragEventDetail, 'deltaX' | 'deltaY'> }
): Vector3Tuple {
  return [
    rotation[0] - event.detail.deltaY * BOX_DRAG_ROTATION_SENSITIVITY,
    rotation[1] - event.detail.deltaX * BOX_DRAG_ROTATION_SENSITIVITY,
    rotation[2]
  ];
}
