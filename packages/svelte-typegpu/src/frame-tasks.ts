import type { TypeGpuNode } from './core';

export interface TypeGpuFrameContext {
  /** Browser timestamp in milliseconds. */
  readonly timestamp: number;
  /** Seconds since the previous rendered frame, clamped to [0, 0.05]. */
  readonly delta: number;
  /** Accumulated clamped frame time in seconds. */
  readonly elapsed: number;
}

export type TypeGpuFrameCallback = (frame: TypeGpuFrameContext) => void;

interface FrameTask {
  update: TypeGpuFrameCallback;
  priority: number;
  continuous: boolean;
}

export class FrameTasks {
  #tasks: FrameTask[] = [];
  #generation = 0;
  #root: TypeGpuNode | null = null;
  #treeRevision = -1;
  #candidates: TypeGpuNode[] = [];

  get continuous(): boolean {
    return this.#tasks.some((task) => task.continuous);
  }

  reconcile(root: TypeGpuNode): void {
    if (this.#root !== root || this.#treeRevision !== root.treeRevision) {
      this.#root = root;
      this.#treeRevision = root.treeRevision;
      this.#candidates = [];
      const visit = (node: TypeGpuNode) => {
        // Discover hidden/inactive tasks too; membership can change without a tree edit.
        if (node.name === 'frameTask') this.#candidates.push(node);
        for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
      };
      visit(root);
    }
    const tasks: FrameTask[] = [];
    for (const node of this.#candidates) {
      let visible = true;
      for (let ancestor: TypeGpuNode | null = node; ancestor; ancestor = ancestor.parent) {
        if (ancestor.attributes.visible === false) { visible = false; break; }
        if (ancestor === root) break;
      }
      if (
        visible &&
        node.attributes.active !== false &&
        typeof node.attributes.update === 'function'
      ) {
        const priority = node.attributes.priority;
        tasks.push({
          update: node.attributes.update as TypeGpuFrameCallback,
          priority: typeof priority === 'number' && Number.isFinite(priority) ? priority : 0,
          continuous: node.attributes.continuous !== false
        });
      }
    }
    // Stable sorting preserves tree order for equal priorities.
    this.#tasks = tasks.sort((a, b) => a.priority - b.priority);
  }

  run(frame: TypeGpuFrameContext): void {
    const snapshot = this.#tasks;
    const generation = this.#generation;
    for (const task of snapshot) {
      if (generation !== this.#generation) break;
      task.update(frame);
    }
  }

  clear(): void {
    this.#tasks = [];
    this.#candidates = [];
    this.#root = null;
    this.#treeRevision = -1;
    this.#generation++;
  }
}
