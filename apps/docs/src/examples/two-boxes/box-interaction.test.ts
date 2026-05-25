import { describe, expect, it } from 'vitest';
import { rotateBoxesFromDrag } from './box-interaction';

describe('two-boxes declarative drag behavior', () => {
  it('rotates boxes from an active object drag without relying on a stale button field', () => {
    const next = rotateBoxesFromDrag([0, 0, 0], {
      detail: {
        button: 0,
        buttons: 1,
        deltaX: 12,
        deltaY: -6
      }
    });

    expect(next[0]).toBeCloseTo(0.018);
    expect(next[1]).toBeCloseTo(-0.036);
    expect(next[2]).toBe(0);
  });
});
