export type FpsSampleHandler = (fps: number) => void;

export interface FpsMeter {
  record(now: number): void;
  reset(now?: number): void;
  dispose(): void;
}

export function createFpsMeter(onSample: FpsSampleHandler, sampleWindowMs = 500): FpsMeter {
  let windowStartedAt: number | null = null;
  let lastTimestamp: number | null = null;
  let lastActivityAt = 0;
  let frames = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  // Recheck only when the deadline expires, not by allocating a timer per frame.
  function checkIdle() {
    timer = null;
    if (disposed) return;
    const remaining = sampleWindowMs - (performance.now() - lastActivityAt);
    if (remaining > 0) {
      timer = setTimeout(checkIdle, Math.ceil(remaining));
      return;
    }
    windowStartedAt = lastTimestamp = null;
    frames = 0;
    onSample(0);
  }

  return {
    record(now: number) {
      if (disposed) return;
      lastActivityAt = performance.now();
      if (timer === null) timer = setTimeout(checkIdle, sampleWindowMs);
      // A backgrounded tab can resume before its overdue idle timer is delivered.
      if (lastTimestamp !== null && now - lastTimestamp >= sampleWindowMs) {
        windowStartedAt = null;
      }
      lastTimestamp = now;
      if (windowStartedAt === null) {
        windowStartedAt = now;
        frames = 0;
        return;
      }

      frames += 1;

      const elapsed = now - windowStartedAt;
      if (elapsed < sampleWindowMs) return;

      onSample(Math.round((frames * 1000) / elapsed));
      windowStartedAt = now;
      frames = 0;
    },
    reset(now: number | null = null) {
      clearTimer();
      windowStartedAt = now;
      lastTimestamp = now;
      frames = 0;
    },
    dispose() {
      disposed = true;
      clearTimer();
    }
  };
}
