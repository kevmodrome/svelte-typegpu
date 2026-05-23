export function createGlbFixture(json: object, binary = new Uint8Array()): ArrayBuffer {
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

function padChunk(bytes: Uint8Array, paddingByte: number): Uint8Array {
  const paddedLength = Math.ceil(bytes.byteLength / 4) * 4;
  const padded = new Uint8Array(paddedLength);
  padded.fill(paddingByte);
  padded.set(bytes);
  return padded;
}
