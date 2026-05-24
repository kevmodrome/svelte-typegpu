import { describe, expect, it, vi } from 'vitest';
import { createFpsMeter } from './fps-meter';

describe('createFpsMeter', () => {
  it('reports rounded frames per second over the sampling window', () => {
    const onSample = vi.fn();
    const meter = createFpsMeter(onSample, 500);

    for (let time = 0; time <= 500; time += 100) {
      meter.record(time);
    }

    expect(onSample).toHaveBeenCalledWith(10);
  });

  it('does not emit samples before the window elapses', () => {
    const onSample = vi.fn();
    const meter = createFpsMeter(onSample, 500);

    meter.record(0);
    meter.record(16);
    meter.record(32);
    meter.record(128);

    expect(onSample).not.toHaveBeenCalled();
  });
});
