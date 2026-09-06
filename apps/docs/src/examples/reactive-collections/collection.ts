import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import type { Vector3Tuple } from 'svelte-typegpu';

export const capacity = 64;
export type CollectionObject = { x: number; z: number; height: number; color: Vector3Tuple };

const colors: Vector3Tuple[] = [[0.2, 0.78, 0.56], [0.85, 0.3, 0.4], [0.25, 0.6, 0.95], [0.85, 0.7, 0.35]];

function createObject(id: number): CollectionObject {
  return { x: id % 8 - 3.5, z: Math.floor(id / 8) - 3.5, height: 0.75 + id % 3 * 0.5, color: [...colors[id % colors.length]] };
}

export function createCollection() {
  const objects = new SvelteMap<number, CollectionObject>();
  const selected = new SvelteSet<number>();

  function reset() {
    objects.clear();
    selected.clear();
    for (let row = 2; row < 6; row++) {
      for (let column = 2; column < 6; column++) {
        const id = row * 8 + column;
        objects.set(id, createObject(id));
      }
    }
  }

  function addObject() {
    for (let id = 0; id < capacity; id++) {
      if (!objects.has(id)) { objects.set(id, createObject(id)); return; }
    }
  }

  function removeSelected() {
    for (const id of selected) objects.delete(id);
    selected.clear();
  }

  function setHeight(id: number, value: number) {
    const object = objects.get(id);
    if (!object) return;
    const height = Number.isFinite(value) ? Math.max(0.25, Math.min(3, value)) : object.height;
    if (height !== object.height) objects.set(id, { ...object, height });
    return height;
  }

  reset();
  return { objects, selected, reset, addObject, removeSelected, setHeight };
}
