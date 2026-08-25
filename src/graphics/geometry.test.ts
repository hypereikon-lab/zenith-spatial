import { describe, expect, test } from "vitest";
import { caveFaceDirection } from "../geometry/cave-projection.js";
import { normalize } from "../projection.js";
import { buildCaveRoomGeometry, buildCylinderRoomGeometry, buildDoubleGableRoomGeometry } from "./geometry.js";
import type { CaveFace } from "../geometry/cave-projection.js";
import type { Vec3 } from "../projection.js";

describe("CAVE room geometry", () => {
  test("builds four walls plus floor with face attributes and no ceiling", () => {
    const geometry = buildCaveRoomGeometry();
    const stride = geometry.vertexStrideFloats;
    const vertexCount = geometry.vertices.length / stride;
    const faceIds = new Set<number>();
    const yValues: number[] = [];

    for (let offset = 0; offset < geometry.vertices.length; offset += stride) {
      yValues.push(geometry.vertices[offset + 1]);
      faceIds.add(geometry.vertices[offset + 5]);
    }

    expect(stride).toBe(6);
    expect(vertexCount).toBe(20);
    expect(geometry.indices.length).toBe(30);
    expect([...faceIds].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(Math.max(...yValues)).toBe(2);
    expect(Math.min(...yValues)).toBe(-2);
  });

  test("uses the same eye-relative wall rays as the CAVE export geometry", () => {
    const geometry = buildCaveRoomGeometry();
    const faceNames: CaveFace[] = ["front", "right", "back", "left", "floor"];

    for (let offset = 0; offset < geometry.vertices.length; offset += geometry.vertexStrideFloats) {
      const position: Vec3 = [geometry.vertices[offset], geometry.vertices[offset + 1], geometry.vertices[offset + 2]];
      const uv = { u: geometry.vertices[offset + 3], v: geometry.vertices[offset + 4] };
      const face = faceNames[geometry.vertices[offset + 5]];
      if (!face) throw new Error("Unexpected CAVE face index");

      expectVectorClose(normalize(position), caveFaceDirection(face, uv));
    }
  });
});

describe("cylinder room geometry", () => {
  test.each([
    ["cylinder-nadir", -2],
    ["cylinder-zenith", 2],
  ] as const)("builds a closed wall and correctly oriented cap for %s", (mode, capY) => {
    const segments = 24;
    const geometry = buildCylinderRoomGeometry(mode, undefined, segments);
    const stride = geometry.vertexStrideFloats;
    const wallVertexCount = segments * 4;
    const capVertexCount = segments * 3;
    const capFaceIds = new Set<number>();
    const capYValues: number[] = [];

    for (let vertex = 0; vertex < wallVertexCount + capVertexCount; vertex += 1) {
      const offset = vertex * stride;
      if (geometry.vertices[offset + 5] !== 1) continue;
      capYValues.push(geometry.vertices[offset + 1]);
      capFaceIds.add(geometry.vertices[offset + 5]);
    }

    expect(stride).toBe(6);
    expect(geometry.vertices.length / stride).toBe(wallVertexCount + capVertexCount);
    expect(geometry.indices.length).toBe(segments * 9);
    expect(capFaceIds).toEqual(new Set([1]));
    expect(capYValues).toHaveLength(capVertexCount);
    expect(Math.min(...capYValues)).toBe(capY);
    expect(Math.max(...capYValues)).toBe(capY);
    expect(Array.from(geometry.vertices).every(Number.isFinite)).toBe(true);
  });
});

describe("double-gable hall geometry", () => {
  test("builds four walls and four roof planes without a floor", () => {
    const geometry = buildDoubleGableRoomGeometry();
    const faceIds = new Set<number>();
    const yByFace = new Map<number, number[]>();
    for (let offset = 0; offset < geometry.vertices.length; offset += geometry.vertexStrideFloats) {
      const face = geometry.vertices[offset + 5];
      faceIds.add(face);
      const values = yByFace.get(face) ?? [];
      values.push(geometry.vertices[offset + 1]);
      yByFace.set(face, values);
    }

    expect(geometry.vertexStrideFloats).toBe(6);
    expect(geometry.vertices.length / geometry.vertexStrideFloats).toBe(56);
    expect(geometry.indices.length).toBe(84);
    expect([...faceIds].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const roofFace of [4, 5, 6, 7]) {
      expect(Math.min(...(yByFace.get(roofFace) ?? []))).toBeGreaterThan(0);
    }
  });

  test("builds every authored plane of an eight-anchor asymmetric roof", () => {
    const geometry = buildDoubleGableRoomGeometry({
      kind: "double-gable-room",
      length: 18,
      width: 12,
      eaveHeight: 7,
      ridgeHeight: 11,
      valleyHeight: 8,
      ridgeInset: 2,
      roofProfile: [
        { id: "a0", position: 0, height: 7, role: "eave" },
        { id: "a1", position: 0.12, height: 10, role: "ridge" },
        { id: "a2", position: 0.27, height: 8.2, role: "valley" },
        { id: "a3", position: 0.41, height: 11, role: "ridge" },
        { id: "a4", position: 0.56, height: 8.7, role: "valley" },
        { id: "a5", position: 0.7, height: 10.4, role: "ridge" },
        { id: "a6", position: 0.86, height: 8, role: "valley" },
        { id: "a7", position: 1, height: 7.4, role: "eave" },
      ],
      eyeHeight: 1.7,
      eyeX: 1.1,
      eyeZ: -0.8,
    });
    const faceIds = new Set<number>();
    for (let offset = 0; offset < geometry.vertices.length; offset += geometry.vertexStrideFloats) {
      faceIds.add(geometry.vertices[offset + 5]);
    }

    expect([...faceIds].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(geometry.vertices.length / geometry.vertexStrideFloats).toBe(92);
    expect(geometry.indices.length).toBe(138);
  });
});

function expectVectorClose(actual: Vec3, expected: Vec3): void {
  for (let index = 0; index < 3; index += 1) {
    expect(actual[index]).toBeCloseTo(expected[index], 6);
  }
}
