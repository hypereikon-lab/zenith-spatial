import { describe, expect, test } from "vitest";

import { readImageByteDimensions } from "./image-byte-dimensions.js";

describe("encoded image dimensions", () => {
  test("reads PNG, JPEG, extended WebP, and lossless WebP headers", () => {
    expect(readImageByteDimensions(fakePng(1920, 1440))).toEqual({ width: 1920, height: 1440 });
    expect(readImageByteDimensions(fakeJpeg(2912, 1248))).toEqual({ width: 2912, height: 1248 });
    expect(readImageByteDimensions(fakeExtendedWebp(1440, 2560))).toEqual({ width: 1440, height: 2560 });
    expect(readImageByteDimensions(fakeLosslessWebp(1920, 1920))).toEqual({ width: 1920, height: 1920 });
  });

  test("rejects unknown and truncated image bytes", () => {
    expect(readImageByteDimensions(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(readImageByteDimensions(fakePng(0, 100))).toBeNull();
    expect(readImageByteDimensions(fakeJpeg(100, 0))).toBeNull();
  });
});

function fakePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return bytes;
}

function fakeJpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(7, height, false);
  view.setUint16(9, width, false);
  bytes.set([0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00], 11);
  return bytes;
}

function fakeExtendedWebp(width: number, height: number): Uint8Array {
  const bytes = webpChunk("VP8X", 10);
  writeUint24LittleEndian(bytes, 24, width - 1);
  writeUint24LittleEndian(bytes, 27, height - 1);
  return bytes;
}

function fakeLosslessWebp(width: number, height: number): Uint8Array {
  const bytes = webpChunk("VP8L", 5);
  const widthMinusOne = width - 1;
  const heightMinusOne = height - 1;
  bytes[20] = 0x2f;
  bytes[21] = widthMinusOne & 0xff;
  bytes[22] = ((widthMinusOne >> 8) & 0x3f) | ((heightMinusOne & 0x03) << 6);
  bytes[23] = (heightMinusOne >> 2) & 0xff;
  bytes[24] = (heightMinusOne >> 10) & 0x0f;
  return bytes;
}

function webpChunk(kind: string, payloadLength: number): Uint8Array {
  const bytes = new Uint8Array(20 + payloadLength);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode("WEBP"), 8);
  bytes.set(new TextEncoder().encode(kind), 12);
  new DataView(bytes.buffer).setUint32(16, payloadLength, true);
  return bytes;
}

function writeUint24LittleEndian(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >> 8) & 0xff;
  bytes[offset + 2] = (value >> 16) & 0xff;
}
