export interface FrameScheduler {
  invalidate(): void;
  setContinuous(active: boolean): void;
  dispose(): void;
}

interface FrameSchedulerOptions {
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(handle: number): void;
  render(timestamp: number): void;
}

export function createFrameScheduler({
  requestFrame,
  cancelFrame,
  render
}: FrameSchedulerOptions): FrameScheduler {
  let frame = 0;
  let continuous = false;

  function schedule() {
    if (frame !== 0) return;
    frame = requestFrame(tick);
  }

  function tick(timestamp: number) {
    frame = 0;
    render(timestamp);

    if (continuous) {
      schedule();
    }
  }

  return {
    invalidate() {
      if (!continuous) {
        schedule();
      }
    },
    setContinuous(active: boolean) {
      if (continuous === active) return;

      continuous = active;
      if (continuous) {
        schedule();
      } else if (frame !== 0) {
        cancelFrame(frame);
        frame = 0;
      }
    },
    dispose() {
      continuous = false;
      if (frame !== 0) {
        cancelFrame(frame);
        frame = 0;
      }
    }
  };
}
