import { describe, expect, it } from 'vitest';
import { SCENE_UNIFORM_FLOATS } from './gpu-renderer';

describe('TypeGPU GPU renderer', () => {
  it('allocates enough floats for the WGSL scene uniform struct alignment', () => {
    expect(SCENE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT).toBe(96);
  });
});
