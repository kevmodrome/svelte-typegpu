import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFpsMeter } from './fps-meter';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('createFpsMeter', () => {
  it.each([60, 120, 144])('reports %i FPS without a 60 FPS cap', (hz) => {
    const onSample = vi.fn();
    const meter = createFpsMeter(onSample);
    for (let frame = 0; frame <= hz; frame++) meter.record(frame * 1000 / hz);
    expect(onSample).toHaveBeenCalledWith(hz);
  });

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

  it.each([60, 120, 144])('reports idle once and resumes at %i FPS without including the idle gap', (hz) => {
    const onSample = vi.fn();
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const meter = createFpsMeter(onSample);
    function animate() {
      meter.record(performance.now());
      for (let frame = 0; frame < hz; frame++) {
        vi.advanceTimersByTime(1000 / hz);
        meter.record(performance.now());
        expect(vi.getTimerCount()).toBe(1);
      }
    }
    animate();
    expect(onSample).toHaveBeenCalledWith(hz);
    expect(onSample).not.toHaveBeenCalledWith(0);
    expect(schedule.mock.calls.length).toBeLessThanOrEqual(4);
    vi.advanceTimersByTime(501);
    expect(onSample).toHaveBeenLastCalledWith(0);
    expect(vi.getTimerCount()).toBe(0);
    onSample.mockClear();
    vi.advanceTimersByTime(5000);
    expect(onSample).not.toHaveBeenCalled();
    animate();
    expect(onSample).toHaveBeenCalled();
    expect(onSample.mock.calls.every(([fps]) => fps === hz)).toBe(true);
    meter.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('excludes a timestamp gap even when the idle timer has not run', () => {
    const onSample = vi.fn();
    const meter = createFpsMeter(onSample);
    meter.record(0);
    meter.record(16);
    meter.record(10000);
    expect(onSample).not.toHaveBeenCalled();
    for (let frame = 1; frame <= 60; frame++) meter.record(10000 + frame * 1000 / 60);
    expect(onSample).toHaveBeenCalledWith(60);
  });

  it('cancels idle work on reset and disposal without notifying an unmounted consumer', () => {
    const onSample = vi.fn();
    const meter = createFpsMeter(onSample);
    meter.record(0);
    meter.reset();
    expect(vi.getTimerCount()).toBe(0);
    meter.record(100);
    meter.dispose();
    meter.record(200);
    vi.advanceTimersByTime(1000);
    expect(vi.getTimerCount()).toBe(0);
    expect(onSample).not.toHaveBeenCalled();
  });
});
