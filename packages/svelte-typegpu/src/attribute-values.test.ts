import { describe, expect, it } from 'vitest';
import { props, value } from './attribute-values';

describe('bounded attribute snapshots', () => {
  it.each(['position', 'rotation', 'scale', 'target', 'lookAt', 'color', 'clearColor',
    'background', 'skyColor', 'groundColor', 'quaternion', 'matrix'])('snapshots and reuses %s tuples', (name) => {
    const input = [1, 2, 3];
    const first = value(name, input);
    expect(first).toEqual(input);
    expect(first).not.toBe(input);
    expect(value(name, input)).toBe(first);
    input[0] = 4;
    const second = value(name, input);
    expect(second).toEqual([4, 2, 3]);
    expect(first).toEqual([1, 2, 3]);
    expect(value(name, input)).toBe(second);
    input.pop();
    expect(value(name, input)).toEqual([4, 2]);
    input.push(9);
    expect(value(name, input)).toEqual([4, 2, 9]);
  });

  it('tracks object vectors without traversing unrelated fields', () => {
    const input: Record<string, unknown> = { x: 1, y: 2, z: 3, get unrelated() { throw new Error('traversed'); } };
    const first = value('position', input);
    expect(first).toEqual({ x: 1, y: 2, z: 3 });
    input.x = 4;
    expect(value('position', input)).toEqual({ x: 4, y: 2, z: 3 });
    delete input.z;
    expect(value('position', input)).toEqual({ x: 4, y: 2 });
    expect(first).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('reuses unchanged uniform vectors while adding, changing and removing slots', () => {
    const input: Record<string, unknown> = { value0: [1, 2, 3], value1: [4, 5], time: 'time' };
    const first = value('uniforms', input) as Record<string, unknown>;
    expect(value('uniforms', input)).toBe(first);
    (input.value0 as number[])[0] = 7;
    const second = value('uniforms', input) as Record<string, unknown>;
    expect(first.value0).toEqual([1, 2, 3]);
    expect(second.value0).toEqual([7, 2, 3]);
    expect(second.value1).toBe(first.value1);
    expect(value('uniforms', input)).toBe(second);
    input.value7 = 3;
    delete input.value1;
    expect(value('uniforms', input)).toEqual({ value0: [7, 2, 3], time: 'time', value7: 3 });
    input.ignored = { get nested() { throw new Error('traversed'); } };
    const third = value('uniforms', input);
    input.ignored = {};
    expect(value('uniforms', input)).toBe(third);
  });

  it('snapshots nested bounds and material descriptors but keeps bulk bytes opaque', () => {
    const bounds = { min: [-1, -1, -1], max: [1, 1, 1] };
    const first = value('bounds', bounds) as typeof bounds;
    bounds.max[0] = 3;
    const second = value('bounds', bounds) as typeof bounds;
    expect(second.min).toBe(first.min);
    expect(first.max[0]).toBe(1);
    expect(second.max[0]).toBe(3);
    const data = new Uint8Array(1_000_000);
    const source = { kind: 'data', data, width: 500, height: 500 };
    const image = value('map', source) as typeof source;
    expect(value('map', source)).toBe(image);
    expect(value('texture', source)).toBe(image);
    source.width = 250;
    const resized = value('map', source) as typeof source;
    expect(resized.width).toBe(250);
    expect(resized.data).toBe(data);
    expect(image.width).toBe(500);
    expect(image.data).toBe(data);
    const sampler = { magFilter: 'nearest' };
    const before = value('sampler', sampler);
    sampler.magFilter = 'linear';
    expect(value('sampler', sampler)).toEqual({ magFilter: 'linear' });
    expect(before).toEqual({ magFilter: 'nearest' });
  });

  it('preserves callback, attachment, asset and typed-array identities through spreads', () => {
    const attachment = Symbol('attachment');
    const asset = { get meshes() { throw new Error('traversed'); } };
    const input = { position: [1, 2, 3], asset, vertices: new Float32Array(10000), onclick() {}, [attachment]() {} };
    const first = props(input) as typeof input;
    expect((props(input) as typeof input).position).toBe(first.position);
    for (const name of ['asset', 'vertices', 'onclick', attachment] as const) expect(first[name]).toBe(input[name]);
    input.position[0] = 4;
    const second = props(input) as typeof input;
    expect(second.position).toEqual([4, 2, 3]);
    expect(first.position).toEqual([1, 2, 3]);
    expect(second.asset).toBe(asset);
    expect((props(input) as typeof input).position).toBe(second.position);
  });

  it('preserves spread key removals, enumerability and special own keys', () => {
    const input = Object.create({ inherited: 1 });
    input.position = [1, 2, 3];
    Object.defineProperty(input, '__proto__', { configurable: true, enumerable: true, writable: true, value: 'data' });
    Object.defineProperty(input, 'hidden', { value: 2 });
    const first = props(input) as Record<string, unknown>;
    expect(first.inherited).toBeUndefined();
    expect(first.hidden).toBeUndefined();
    expect(first.__proto__).toBe('data');
    delete input.position;
    const second = props(input);
    expect(second).toEqual({ ['__proto__']: 'data' });
    expect(props(input)).toEqual(second);
    Object.defineProperty(input, '__proto__', { enumerable: false });
    expect(props(input)).toEqual({});
  });

  it('never scans arbitrary assets or over-limit tuples', () => {
    const opaque = new Proxy({}, { get() { throw new Error('traversed'); }, ownKeys() { throw new Error('traversed'); } });
    for (const name of ['asset', 'vertices', 'indices', 'data', 'fragment', 'custom']) expect(value(name, opaque)).toBe(opaque);
    const large = new Proxy(new Array(10_000), { get(target, key) {
      if (key !== 'length') throw new Error('scanned a bulk array');
      return target.length;
    } });
    expect(value('matrix', large)).toBe(large);
    for (const input of [null, undefined, false, 1, 'url', new Float32Array(16)]) expect(value('matrix', input)).toBe(input);
    expect(props(null)).toBeNull();
  });
});
