import { writeToArrayBuffer } from "typegpu";
import { sizeOf, type AnyData, type InferInput } from "typegpu/data";

/**
 * CPU-side encoder for parity tests and focused browser probe fixtures.
 * Production renderers write the same values through TypeGPU uniforms.
 */
export function encodeTypeGpuData<TSchema extends AnyData>(schema: TSchema, value: InferInput<TSchema>): Float32Array {
  const bytes = sizeOf(schema);
  const buffer = new ArrayBuffer(bytes);
  writeToArrayBuffer(buffer, schema, value);
  return new Float32Array(buffer);
}
