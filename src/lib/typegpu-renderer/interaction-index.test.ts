import { describe, expect, it } from 'vitest';
import { createElement } from './core';
import { createInteractionIndex } from './interaction-index';

describe('TypeGPU interaction index', () => {
  it('picks the nearest bounds hit instead of the first target', () => {
    const far = createElement('mesh');
    const near = createElement('mesh');
    const index = createInteractionIndex([
      {
        node: far,
        instanceId: 'far',
        bounds: { min: [-1, -1, -6], max: [1, 1, -4] },
        hitTest: 'bounds',
        handlers: new Set(['click'])
      },
      {
        node: near,
        instanceId: 'near',
        bounds: { min: [-1, -1, -3], max: [1, 1, -2] },
        hitTest: 'bounds',
        handlers: new Set(['click'])
      }
    ]);

    const hit = index.pick({
      x: 50,
      y: 50,
      viewport: { width: 100, height: 100 },
      camera: {
        projection: 'perspective',
        position: [0, 0, 0],
        target: [0, 0, -1],
        fov: 45,
        near: 0.1,
        far: 100
      }
    });

    expect(hit?.node).toBe(near);
    expect(hit?.instanceId).toBe('near');
  });

  it('excludes pointerEvents none and hitTest none targets during creation', () => {
    const interactive = createElement('mesh');
    const ignoredHitTest = createElement('mesh');
    const ignoredPointerEvents = createElement('mesh');
    const index = createInteractionIndex([
      {
        node: ignoredHitTest,
        instanceId: 'ignored-hit-test',
        bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
        hitTest: 'none',
        handlers: new Set(['click'])
      },
      {
        node: ignoredPointerEvents,
        instanceId: 'ignored-pointer-events',
        bounds: { min: [-1, -1, -2], max: [1, 1, -1] },
        hitTest: 'bounds',
        pointerEvents: 'none',
        handlers: new Set(['click'])
      },
      {
        node: interactive,
        instanceId: 'interactive',
        bounds: { min: [-1, -1, -2], max: [1, 1, -1] },
        hitTest: 'bounds',
        handlers: new Set(['click'])
      }
    ]);

    expect(index.targets.map((target) => target.instanceId)).toEqual(['interactive']);
  });
});
