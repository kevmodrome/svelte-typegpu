import { describe, expect, it } from 'vitest';
import { createGlbFixture, createInvalidGlbHeader } from './glb-test-fixtures';
import { parseGlbContainer } from './glb-loader';

describe('GLB loader', () => {
  it('parses a GLB v2 JSON chunk and binary chunk', () => {
    const binary = new Uint8Array([1, 2, 3, 4]);
    const parsed = parseGlbContainer(
      createGlbFixture({ asset: { version: '2.0' }, scenes: [] }, binary)
    );

    expect(parsed.json).toEqual({ asset: { version: '2.0' }, scenes: [] });
    expect(Array.from(parsed.binary)).toEqual([1, 2, 3, 4]);
  });

  it('rejects unsupported GLB versions', () => {
    expect(() => parseGlbContainer(createInvalidGlbHeader(1))).toThrow(
      'Unsupported GLB version 1'
    );
  });
});
