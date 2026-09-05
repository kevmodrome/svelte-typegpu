import {
  addEventListener,
  removeEventListener,
  type TypeGpuNode,
  type TypeGpuNodeEvent
} from './core';

/** A Svelte attachment whose target is a scene node, not a DOM element. */
export type TypeGpuAttachment = (node: TypeGpuNode) => void | (() => void);

/** Subscribe to a picked scene-node event and return an idempotent cleanup function. */
export function onNodeEvent(
  node: TypeGpuNode,
  type: string,
  handler: (event: TypeGpuNodeEvent) => void
): () => void {
  // Each subscription owns its registration, even when callbacks are shared.
  const listener = (event: TypeGpuNodeEvent) => handler(event);
  addEventListener(node, type, listener);
  return () => removeEventListener(node, type, listener);
}
