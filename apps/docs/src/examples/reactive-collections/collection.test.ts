import { describe, expect, it } from 'vitest';
import { capacity, createCollection } from './collection';

describe('reactive collection editor commands', () => {
  it('keeps objects and selection private to each instance', () => {
    const first = createCollection(), second = createCollection();
    expect(first.objects.size).toBe(16);
    first.objects.get(18)!.color[0] = 0;
    expect(second.objects.get(18)!.color[0]).toBe(0.25);
    expect(first.objects.get(26)!.color[0]).toBe(0.25);
    first.objects.clear(); first.selected.add(18);
    expect(second.objects.size).toBe(16);
    expect(second.selected.size).toBe(0);
  });

  it('fills empty cells without replacing existing objects or exceeding capacity', () => {
    const { objects, addObject } = createCollection();
    const first = objects.get(18);
    for (let i = 0; i < capacity; i++) addObject();
    expect(objects.size).toBe(capacity);
    expect(objects.get(18)).toBe(first);
    expect(new Set([...objects.values()].map(({ x, z }) => `${x},${z}`)).size).toBe(capacity);
    objects.delete(10); addObject();
    expect(objects.size).toBe(capacity);
    expect(objects.get(10)).toMatchObject({ x: -1.5, z: -2.5 });
  });

  it('replaces only changed records and bounds invalid height input', () => {
    const { objects, setHeight } = createCollection();
    const first = objects.get(18)!, sibling = objects.get(19);
    setHeight(18, first.height);
    expect(objects.get(18)).toBe(first);
    expect(setHeight(18, NaN)).toBe(first.height);
    expect(objects.get(18)).toBe(first);
    expect(setHeight(18, 10)).toBe(3);
    expect(objects.get(18)).not.toBe(first);
    expect(objects.get(19)).toBe(sibling);
    expect(setHeight(18, -1)).toBe(0.25);
    expect(setHeight(-1, 1)).toBeUndefined();
    expect(objects.size).toBe(16);
  });

  it('removes selected objects, clears stale selection, and resets both collections in place', () => {
    const state = createCollection();
    const { objects, selected } = state;
    selected.add(18); selected.add(-1); state.removeSelected();
    expect(objects.size).toBe(15);
    expect(objects.has(18)).toBe(false);
    expect(selected.size).toBe(0);
    state.addObject(); state.setHeight(19, 3); selected.add(19);
    state.reset();
    expect(state.objects).toBe(objects); expect(state.selected).toBe(selected);
    expect(objects.size).toBe(16);
    expect(objects.has(0)).toBe(false);
    expect(objects.has(18)).toBe(true);
    expect(objects.get(19)!.height).toBe(1.25);
    expect(selected.size).toBe(0);
  });
});
