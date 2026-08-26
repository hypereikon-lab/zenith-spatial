export type ImageByteDimensions = {
  readonly width: number;
  readonly height: number;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const JPEG_START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** Reads encoded pixel dimensions without browser APIs or raster re-encoding. */
export function readImageByteDimensions(bytes: Uint8Array): ImageByteDimensions | null {
  return readPngDimensions(bytes) ?? readJpegDimensions(bytes) ?? readWebpDimensions(bytes);
}

function readPngDimensions(bytes: Uint8Array): ImageByteDimensions | null {
  if (bytes.length < 24 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return null;
  if (ascii(bytes, 12, 16) !== "IHDR") return null;
  return positiveDimensions(readUint32BigEndian(bytes, 16), readUint32BigEndian(bytes, 20));
}

function readJpegDimensions(bytes: Uint8Array): ImageByteDimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return null;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = readUint16BigEndian(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (JPEG_START_OF_FRAME.has(marker) && length >= 7) {
      return positiveDimensions(readUint16BigEndian(bytes, offset + 5), readUint16BigEndian(bytes, offset + 3));
    }
    offset += length;
  }
  return null;
}

function readWebpDimensions(bytes: Uint8Array): ImageByteDimensions | null {
  if (bytes.length < 20 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 12) !== "WEBP") return null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const kind = ascii(bytes, offset, offset + 4);
    const length = readUint32LittleEndian(bytes, offset + 4);
    const payload = offset + 8;
    if (payload + length > bytes.length) return null;
    if (kind === "VP8X" && length >= 10) {
      return positiveDimensions(
        1 + readUint24LittleEndian(bytes, payload + 4),
        1 + readUint24LittleEndian(bytes, payload + 7),
      );
    }
    if (
      kind === "VP8 " &&
      length >= 10 &&
      bytes[payload + 3] === 0x9d &&
      bytes[payload + 4] === 0x01 &&
      bytes[payload + 5] === 0x2a
    ) {
      return positiveDimensions(
        readUint16LittleEndian(bytes, payload + 6) & 0x3fff,
        readUint16LittleEndian(bytes, payload + 8) & 0x3fff,
      );
    }
    if (kind === "VP8L" && length >= 5 && bytes[payload] === 0x2f) {
      const first = bytes[payload + 1]!;
      const second = bytes[payload + 2]!;
      const third = bytes[payload + 3]!;
      const fourth = bytes[payload + 4]!;
      return positiveDimensions(
        1 + first + ((second & 0x3f) << 8),
        1 + (second >> 6) + (third << 2) + ((fourth & 0x0f) << 10),
      );
    }
    offset = payload + length + (length & 1);
  }
  return null;
}

function positiveDimensions(width: number, height: number): ImageByteDimensions | null {
  return Number.isSafeInteger(width) && Number.isSafeInteger(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let value = "";
  for (let index = start; index < end; index += 1) value += String.fromCharCode(bytes[index]!);
  return value;
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}
