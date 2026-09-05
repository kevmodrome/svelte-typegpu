import * as client from 'svelte/internal/client';

// Compiler-only facade: component source cannot import Svelte internals directly.
// Delegate observation, scheduling and cleanup to the pinned native runtime.
interface CanvasBindingRuntime {
  bind_element_size<K extends 'clientWidth' | 'clientHeight' | 'offsetWidth' | 'offsetHeight'>(
    element: HTMLCanvasElement, key: K, set: (value: number) => void
  ): void;
  bind_resize_observer<K extends 'contentRect' | 'contentBoxSize' | 'borderBoxSize' | 'devicePixelContentBoxSize'>(
    element: HTMLCanvasElement, key: K, set: (value: ResizeObserverEntry[K]) => void
  ): void;
  untrack<T>(fn: () => T): T;
}

// Static property access keeps Bun/Vite from retaining the entire client namespace.
export const bind_element_size = (client as unknown as CanvasBindingRuntime).bind_element_size;
export const bind_resize_observer = (client as unknown as CanvasBindingRuntime).bind_resize_observer;
export const untrack = (client as unknown as CanvasBindingRuntime).untrack;
