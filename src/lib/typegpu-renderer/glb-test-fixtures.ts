export function createGlbFixture(
  json: object,
  binary: Uint8Array<ArrayBufferLike> = new Uint8Array()
): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const paddedJson = padChunk(jsonBytes, 0x20);
  const paddedBinary = padChunk(binary, 0);
  const hasBinary = paddedBinary.byteLength > 0;
  const byteLength = 12 + 8 + paddedJson.byteLength + (hasBinary ? 8 + paddedBinary.byteLength : 0);
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, 0x46546c67, true);
  offset += 4;
  view.setUint32(offset, 2, true);
  offset += 4;
  view.setUint32(offset, byteLength, true);
  offset += 4;

  view.setUint32(offset, paddedJson.byteLength, true);
  offset += 4;
  view.setUint32(offset, 0x4e4f534a, true);
  offset += 4;
  new Uint8Array(buffer, offset, paddedJson.byteLength).set(paddedJson);
  offset += paddedJson.byteLength;

  if (hasBinary) {
    view.setUint32(offset, paddedBinary.byteLength, true);
    offset += 4;
    view.setUint32(offset, 0x004e4942, true);
    offset += 4;
    new Uint8Array(buffer, offset, paddedBinary.byteLength).set(paddedBinary);
  }

  return buffer;
}

export function createInvalidGlbHeader(version: number): ArrayBuffer {
  const buffer = createGlbFixture({ asset: { version: '2.0' } });
  new DataView(buffer).setUint32(4, version, true);
  return buffer;
}

export function float32Bytes(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * Float32Array.BYTES_PER_ELEMENT);
  new Float32Array(buffer).set(values);
  return new Uint8Array(buffer);
}

export function uint16Bytes(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * Uint16Array.BYTES_PER_ELEMENT);
  new Uint16Array(buffer).set(values);
  return new Uint8Array(buffer);
}

export function uint32Bytes(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * Uint32Array.BYTES_PER_ELEMENT);
  new Uint32Array(buffer).set(values);
  return new Uint8Array(buffer);
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function padChunk(bytes: Uint8Array<ArrayBufferLike>, paddingByte: number): Uint8Array {
  const paddedLength = Math.ceil(bytes.byteLength / 4) * 4;
  const padded = new Uint8Array(paddedLength);
  padded.fill(paddingByte);
  padded.set(bytes);
  return padded;
}
