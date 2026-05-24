import { describe, expect, it, vi } from 'vitest';
import { createFrameScheduler } from './frame-scheduler';

describe('createFrameScheduler', () => {
  it('coalesces invalidations into one frame when idle', () => {
    const render = vi.fn();
    const scheduled: Array<(time: number) => void> = [];
    const scheduler = createFrameScheduler({
      requestFrame(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancelFrame: vi.fn(),
      render
    });

    scheduler.invalidate();
    scheduler.invalidate();
    expect(scheduled).toHaveLength(1);

    scheduled[0](16);
    expect(render).toHaveBeenCalledWith(16);
  });

  it('renders every frame while continuous mode is active', () => {
    const render = vi.fn();
    const scheduled: Array<(time: number) => void> = [];
    const scheduler = createFrameScheduler({
      requestFrame(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancelFrame: vi.fn(),
      render
    });

    scheduler.setContinuous(true);
    scheduled[0](16);
    scheduled[1](32);
    scheduled[2](48);

    expect(render).toHaveBeenCalledTimes(3);
    expect(render).toHaveBeenNthCalledWith(3, 48);
  });

  it('stops scheduling continuous frames when disabled', () => {
    const render = vi.fn();
    const cancelFrame = vi.fn();
    const scheduled: Array<(time: number) => void> = [];
    const scheduler = createFrameScheduler({
      requestFrame(callback) {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancelFrame,
      render
    });

    scheduler.setContinuous(true);
    scheduler.setContinuous(false);

    expect(cancelFrame).toHaveBeenCalledWith(1);
  });
});
