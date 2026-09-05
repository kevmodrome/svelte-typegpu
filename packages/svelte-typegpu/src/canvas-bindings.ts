import * as client from 'svelte/internal/client';

// Compiler-only facade: component source cannot import Svelte internals directly.
// Delegate observation, scheduling and cleanup to the pinned native runtime.
export const { bind_element_size, bind_resize_observer, untrack } = client as unknown as {
  bind_element_size<K extends 'clientWidth' | 'clientHeight' | 'offsetWidth' | 'offsetHeight'>(
    element: HTMLCanvasElement, key: K, set: (value: number) => void
  ): void;
  bind_resize_observer<K extends 'contentRect' | 'contentBoxSize' | 'borderBoxSize' | 'devicePixelContentBoxSize'>(
    element: HTMLCanvasElement, key: K, set: (value: ResizeObserverEntry[K]) => void
  ): void;
  untrack<T>(fn: () => T): T;
};
