interface ContinuityEntry {
  offset: number;
  rate: number;
}

export type ContinuityKey = number | string;

export interface ContinuityInput {
  key: ContinuityKey;
  rate: number;
  time: number;
}

export interface ContinuityTracker {
  offsetFor(input: ContinuityInput): number;
  prune(liveKeys: Iterable<ContinuityKey>): void;
}

export function createContinuityTracker(): ContinuityTracker {
  const entries = new Map<ContinuityKey, ContinuityEntry>();

  return {
    offsetFor({ key, rate, time }) {
      const entry = entries.get(key);

      if (!entry) {
        entries.set(key, { offset: 0, rate });
        return 0;
      }

      if (entry.rate !== rate) {
        entry.offset += time * (entry.rate - rate);
        entry.rate = rate;
      }

      return entry.offset;
    },
    prune(liveKeys) {
      const live = new Set(liveKeys);

      for (const key of entries.keys()) {
        if (!live.has(key)) entries.delete(key);
      }
    }
  };
}
