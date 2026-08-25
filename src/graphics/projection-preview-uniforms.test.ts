import { describe, expect, test } from "vitest";
import { readFromArrayBuffer } from "typegpu";
import type { Mat4, Vec3 } from "../projection.js";
import { projectionPreviewUniformSchema } from "./typegpu/contracts.js";
import {
  buildProjectionPreviewUniformArray,
  PROJECTION_PREVIEW_UNIFORM_BYTES,
  PROJECTION_PREVIEW_UNIFORM_FLOATS,
} from "./projection-preview-uniforms.js";
import { compileProjectionKernelParams } from "../geometry/projection-kernel-parameters.js";

describe("projection preview TypeGPU uniforms", () => {
  test("serializes the named projection contract with the WGSL-compatible size and alignment", () => {
    const mvp = new Float32Array(Array.from({ length: 16 }, (_, index) => index + 1)) as Mat4;
    const cameraPosition: Vec3 = [4, 5, 6];

    const uniforms = buildProjectionPreviewUniformArray({
      mvp,
      overlayOpacity: 0.78,
      showGuides: true,
      shellShade: 0.12,
      caveMaskMode: 2,
      cameraPosition,
      sourceOverlayOpacity: 0.66,
      sourceCapDetailAvailable: true,
      kernel: compileProjectionKernelParams({ mode: "cave-270", width: 1280, height: 720 }),
    });
    const decoded = readFromArrayBuffer(uniforms.buffer as ArrayBuffer, projectionPreviewUniformSchema);

    expect(PROJECTION_PREVIEW_UNIFORM_FLOATS).toBe(104);
    expect(PROJECTION_PREVIEW_UNIFORM_BYTES).toBe(416);
    expect(uniforms).toHaveLength(PROJECTION_PREVIEW_UNIFORM_FLOATS);
    expect(uniforms.byteLength).toBe(PROJECTION_PREVIEW_UNIFORM_BYTES);
    expect(Array.from(uniforms.subarray(0, 16))).toEqual(Array.from(mvp));
    expect(decoded.rotation).toBe(0);
    expect(decoded.exposure).toBe(1);
    expect(decoded.overlayOpacity).toBeCloseTo(0.78);
    expect(decoded.showRings).toBe(1);
    expect(decoded.showSpokes).toBe(1);
    expect(decoded.showHorizon).toBe(1);
    expect(decoded.showZenith).toBe(1);
    expect(decoded.showSourceCircle).toBe(1);
    expect(decoded.shellShade).toBeCloseTo(0.12);
    expect(decoded.showCaveMask).toBe(2);
    expect([decoded.cameraPosX, decoded.cameraPosY, decoded.cameraPosZ]).toEqual(cameraPosition);
    expect(decoded.sourceOverlay[0]).toBeCloseTo(0.66);
    expect(Array.from(decoded.sourceOverlay.slice(1))).toEqual([1, 0, 0]);
    expect(decoded.kernel.topology).toBe(1);
  });

  test("keeps guide and optional boolean slots as explicit shader floats", () => {
    const uniforms = buildProjectionPreviewUniformArray({
      mvp: new Float32Array(
        Array.from({ length: 16 }, (_, index) => (index === 0 || index === 5 || index === 10 || index === 15 ? 1 : 0)),
      ) as Mat4,
      rotation: 0.25,
      exposure: 0.5,
      overlayOpacity: 0.28,
      mirror: true,
      domeTilt: -0.4,
      cutaway: true,
      showGuides: false,
      shellShade: 0.3,
      caveMaskMode: 0,
      cameraPosition: [0, 0, 0],
      kernel: compileProjectionKernelParams({ mode: "zenith-180", width: 1024, height: 1024 }),
    });
    const decoded = readFromArrayBuffer(uniforms.buffer as ArrayBuffer, projectionPreviewUniformSchema);

    expect(decoded.rotation).toBeCloseTo(0.25);
    expect(decoded.exposure).toBeCloseTo(0.5);
    expect(decoded.mirror).toBe(1);
    expect(decoded.domeTilt).toBeCloseTo(-0.4);
    expect(decoded.cutaway).toBe(1);
    expect(decoded.showRings).toBe(0);
    expect(decoded.showSourceCircle).toBe(0);
    expect(Array.from(decoded.sourceOverlay)).toEqual([0, 0, 0, 0]);
  });

  test("separates directional guides from exact carrier edges", () => {
    const base = {
      mvp: new Float32Array(
        Array.from({ length: 16 }, (_, index) => (index === 0 || index === 5 || index === 10 || index === 15 ? 1 : 0)),
      ) as Mat4,
      overlayOpacity: 0.78,
      shellShade: 0.3,
      caveMaskMode: 0 as const,
      cameraPosition: [0, 0, 0] as Vec3,
      kernel: compileProjectionKernelParams({ mode: "hall-double-gable", width: 1024, height: 1024 }),
    };
    const guides = readFromArrayBuffer(
      buildProjectionPreviewUniformArray({ ...base, guideOverlay: "guides" }).buffer as ArrayBuffer,
      projectionPreviewUniformSchema,
    );
    const edge = readFromArrayBuffer(
      buildProjectionPreviewUniformArray({ ...base, guideOverlay: "edge" }).buffer as ArrayBuffer,
      projectionPreviewUniformSchema,
    );
    const clean = readFromArrayBuffer(
      buildProjectionPreviewUniformArray({ ...base, guideOverlay: "clean" }).buffer as ArrayBuffer,
      projectionPreviewUniformSchema,
    );

    expect([guides.showRings, guides.showSpokes, guides.showHorizon, guides.showZenith]).toEqual([1, 1, 1, 1]);
    expect(guides.showSourceCircle).toBe(0);
    expect([edge.showRings, edge.showSpokes, edge.showHorizon, edge.showZenith]).toEqual([0, 0, 0, 0]);
    expect(edge.showSourceCircle).toBe(1);
    expect([clean.showRings, clean.showSpokes, clean.showHorizon, clean.showZenith, clean.showSourceCircle]).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });
});
