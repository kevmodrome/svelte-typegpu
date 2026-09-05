import type { TypeGpuNode } from '../../src/core';
import type { TypeGpuAttachment } from '../../src/attachments';

// An unpublished minimal reproduction of released language-tools behavior.
declare module 'svelte/elements' {
  interface SvelteHTMLElements {
    scene: { clearColor?: [number, number, number, number] };
    mesh: { [key: symbol]: TypeGpuAttachment | undefined };
  }
}

declare global {
  namespace svelteHTML {
    function mapElementTag<K extends 'scene' | 'mesh'>(tag: K): TypeGpuNode;
  }
}
