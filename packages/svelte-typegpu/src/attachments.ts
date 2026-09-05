import {
  addEventListener,
  removeEventListener,
  type TypeGpuNode,
  type TypeGpuNodeEvent,
  type TypeGpuNodeEventHandler
} from './core';
import { captureOption, type TypeGpuEventListenerOptions } from './node-events';

/** A Svelte attachment whose target is a scene node, not a DOM element. */
export type TypeGpuAttachment = (node: TypeGpuNode) => void | (() => void);

/** Subscribe to a picked scene-node event and return an idempotent cleanup function. */
export function onNodeEvent(
  node: TypeGpuNode,
  type: string,
  handler: TypeGpuNodeEventHandler,
  options?: TypeGpuEventListenerOptions
): () => void {
  // Each subscription owns its registration, even when callbacks are shared.
  const listener = (event: TypeGpuNodeEvent) => handler.call(node, event);
  const capture = captureOption(options);
  addEventListener(node, type, listener, capture);
  return () => removeEventListener(node, type, listener, capture);
}
