import { describe, expect, it } from 'vitest';
import { rotateBoxesFromDrag } from './box-interaction';

describe('two-boxes declarative drag behavior', () => {
  it('rotates boxes from a secondary object drag without relying on a stale button field', () => {
    const next = rotateBoxesFromDrag([0, 0, 0, 1], {
      detail: {
        button: -1,
        buttons: 2,
        deltaX: 12,
        deltaY: -6
      }
    });

    expect(next[0]).toBeCloseTo(0.008998421, 8);
    expect(next[1]).toBeCloseTo(-0.017998299, 8);
    expect(next[2]).toBeCloseTo(0.000161989, 8);
    expect(next[3]).toBeCloseTo(0.999797511, 8);
  });

  it('leaves box rotation unchanged for primary object drags', () => {
    const rotation = [0, 0, 0, 1] as const;
    const next = rotateBoxesFromDrag(rotation, {
      detail: {
        button: 0,
        buttons: 1,
        deltaX: 12,
        deltaY: -6
      }
    });

    expect(next).toBe(rotation);
  });
});
