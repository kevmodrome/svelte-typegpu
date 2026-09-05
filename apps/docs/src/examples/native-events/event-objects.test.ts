import { describe, expect, it } from 'vitest';
import { createEventObjects, resizeObject, rotateObject } from './event-objects';

describe('native event example objects', () => {
  it('owns independent state per mounted example', () => {
    const first = createEventObjects();
    const second = createEventObjects();
    resizeObject(first[0], 10);
    first[0].color[0] = 0;
    expect(second[0].size).toBe(1);
    expect(second[0].color[0]).toBe(0.94);
  });

  it('clamps size and wraps rotation for repeated input', () => {
    const object = createEventObjects()[0];
    resizeObject(object, 100);
    expect(object.size).toBe(1.6);
    resizeObject(object, -100);
    expect(object.size).toBe(0.6);
    rotateObject(object, 195);
    expect(object.angle).toBe(-165);
    rotateObject(object, -750);
    expect(object.angle).toBe(165);
  });
});
