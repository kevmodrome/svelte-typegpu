export type FpsSampleHandler = (fps: number) => void;

export interface FpsMeter {
  record(now: number): void;
  reset(now?: number): void;
}

export function createFpsMeter(onSample: FpsSampleHandler, sampleWindowMs = 500): FpsMeter {
  let windowStartedAt: number | null = null;
  let frames = 0;

  return {
    record(now: number) {
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
      windowStartedAt = now;
      frames = 0;
    }
  };
}
