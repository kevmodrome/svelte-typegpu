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

  it('rejects GLB data that is too short', () => {
    expect(() => parseGlbContainer(new ArrayBuffer(12))).toThrow('GLB is too short.');
  });

  it('rejects invalid GLB magic', () => {
    const buffer = createGlbFixture({ asset: { version: '2.0' } });
    new DataView(buffer).setUint32(0, 0, true);

    expect(() => parseGlbContainer(buffer)).toThrow('Invalid GLB magic.');
  });

  it('rejects declared length mismatches', () => {
    const buffer = createGlbFixture({ asset: { version: '2.0' } });
    new DataView(buffer).setUint32(8, buffer.byteLength + 4, true);

    expect(() => parseGlbContainer(buffer)).toThrow(
      'GLB length does not match the buffer length.'
    );
  });

  it('rejects malformed chunk headers', () => {
    const buffer = withTrailingBytes(createGlbFixture({ asset: { version: '2.0' } }), 4);

    expect(() => parseGlbContainer(buffer)).toThrow('Malformed GLB chunk header.');
  });

  it('rejects malformed chunk lengths', () => {
    const buffer = createGlbFixture({ asset: { version: '2.0' } });
    new DataView(buffer).setUint32(12, buffer.byteLength, true);

    expect(() => parseGlbContainer(buffer)).toThrow('Malformed GLB chunk length.');
  });

  it('rejects GLB data without a JSON chunk', () => {
    const buffer = createGlbFixture({ asset: { version: '2.0' } });
    new DataView(buffer).setUint32(16, 0x004e4942, true);

    expect(() => parseGlbContainer(buffer)).toThrow('GLB JSON chunk is missing.');
  });

  it('trims JSON space padding before parsing', () => {
    const json = { asset: { version: '2.0' }, scenes: [] };
    expect(new TextEncoder().encode(JSON.stringify(json)).byteLength % 4).not.toBe(0);

    expect(parseGlbContainer(createGlbFixture(json)).json).toEqual(json);
  });

  it('returns an empty binary chunk when BIN is absent', () => {
    const parsed = parseGlbContainer(createGlbFixture({ asset: { version: '2.0' } }));

    expect(parsed.binary).toBeInstanceOf(Uint8Array);
    expect(parsed.binary.byteLength).toBe(0);
  });
});

function withTrailingBytes(input: ArrayBuffer, trailingByteLength: number): ArrayBuffer {
  const buffer = new ArrayBuffer(input.byteLength + trailingByteLength);
  new Uint8Array(buffer).set(new Uint8Array(input));
  new DataView(buffer).setUint32(8, buffer.byteLength, true);
  return buffer;
}
