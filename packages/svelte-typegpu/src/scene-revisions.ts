import type { TypeGpuNode } from './core';

interface RevisionEntry {
  dependencies: readonly unknown[];
  revision: number;
}

// Compare dependencies directly: nested arithmetic hashes lose integer precision.
export class SceneRevisionCache {
  #nodes = new WeakMap<TypeGpuNode, Map<string | number, RevisionEntry>>();
  #nextRevision = 1;

  read(node: TypeGpuNode, slot: string | number, dependencies: readonly unknown[]): number {
    let entries = this.#nodes.get(node);
    const previous = entries?.get(slot);
    if (
      previous &&
      previous.dependencies.length === dependencies.length &&
      dependencies.every((value, index) => Object.is(value, previous.dependencies[index]))
    ) {
      return previous.revision;
    }

    if (!entries) {
      entries = new Map();
      this.#nodes.set(node, entries);
    }
    const revision = this.#nextRevision++;
    entries.set(slot, { dependencies, revision });
    return revision;
  }
}
