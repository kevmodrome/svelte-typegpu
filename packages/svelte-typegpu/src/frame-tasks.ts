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

  get continuous(): boolean {
    return this.#tasks.some((task) => task.continuous);
  }

  reconcile(root: TypeGpuNode): void {
    const tasks: FrameTask[] = [];
    function visit(node: TypeGpuNode, parentVisible: boolean) {
      const visible = parentVisible && node.attributes.visible !== false;
      if (!visible) return;
      if (
        node.name === 'frameTask' &&
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
      for (let child = node.firstChild; child; child = child.nextSibling) visit(child, visible);
    }
    visit(root, true);
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
    this.#generation++;
  }
}
