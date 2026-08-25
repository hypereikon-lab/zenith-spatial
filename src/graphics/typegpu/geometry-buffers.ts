import { d, type IndexFlag, type TgpuBuffer, type TgpuRoot, type VertexFlag } from "typegpu";
import type { F32, U32, WgslArray } from "typegpu/data";

export type PackedVertexBuffer = TgpuBuffer<WgslArray<F32>> & VertexFlag;
export type Uint32IndexBuffer = TgpuBuffer<WgslArray<U32>> & IndexFlag;

/**
 * TypeGPU-owned packed geometry for legacy interleaved meshes. The buffer
 * lifecycle and usage are typed now; vertex attribute schemas are attached by
 * the typed projection pipeline during the next migration layer.
 */
export function createPackedVertexBuffer(root: TgpuRoot, data: Float32Array): PackedVertexBuffer {
  const buffer = root.createBuffer(d.arrayOf(d.f32, data.length)).$usage("vertex");
  buffer.write(ownedArrayBuffer(data));
  return buffer;
}

export function createUint32IndexBuffer(root: TgpuRoot, data: Uint32Array): Uint32IndexBuffer {
  const buffer = root.createBuffer(d.arrayOf(d.u32, data.length)).$usage("index");
  buffer.write(ownedArrayBuffer(data));
  return buffer;
}

function ownedArrayBuffer(data: Float32Array | Uint32Array): ArrayBuffer {
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return bytes.buffer;
}
