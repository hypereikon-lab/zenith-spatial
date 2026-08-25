import { describe, expect, test } from "vitest";
import {
  caveShaderCode,
  cylinderShaderCode,
  domeShaderCode,
  flatShaderCode,
} from "./typegpu/projection-preview-pipeline.js";

const projectionShaders = {
  cave: caveShaderCode,
  cylinder: cylinderShaderCode,
  dome: domeShaderCode,
  flat: flatShaderCode,
};

describe("TypeGPU projection shaders", () => {
  test.each(Object.entries(projectionShaders))("resolves the governed projection ABI for %s", (_name, shader) => {
    expect(shader).toContain("struct projectionKernelParamsSchema");
    expect(shader).toContain("kernel: projectionKernelParamsSchema");
    expect(shader).toContain("mode: u32");
    expect(shader).toContain("topology: u32");
    expect(shader).toContain("physicalSemantic: f32");
    expect(shader).toContain("physicalHorizon: f32");
    expect(shader).not.toContain("projectionMode");
    expect(shader).not.toContain("customCurve");
  });

  test.each(Object.entries(projectionShaders))(
    "does not emit lossy float-to-integer projection state for %s",
    (_name, shader) => {
      expect(shader).not.toMatch(/var (radiusFraction|rho|radius) = 0i/);
      expect(shader).not.toMatch(/\b(radiusFraction|rho) = i32\(/);
      expect(shader).not.toContain("fn piecewiseMap4(value: f32, from0: i32");
    },
  );
});

describe("dome projection shader", () => {
  test("uses the portable orientation and source-mapping kernels", () => {
    expect(domeShaderCode).toContain("fn physicalDirectionFromSourceKernel");
    expect(domeShaderCode).toContain("fn sourceDirectionFromPhysicalKernel");
    expect(domeShaderCode).toContain("fn sourceDirectionToUvKernel");
    expect(domeShaderCode).toContain(
      "return physicalDirectionFromSourceKernel(sourceDir, uniforms.rotation, uniforms.domeTilt, uniforms.mirror)",
    );
    expect(domeShaderCode).toContain("uniforms.kernel.physicalHorizon");
    expect(domeShaderCode).toContain("@group(0) @binding(3) var overlayTexture");
  });
});

describe("flat source-map shader", () => {
  test("keeps texture sampling uniform and masks the circular carrier afterward", () => {
    const sampleIndex = flatShaderCode.indexOf("sampleSourceColor(sampleUv)");
    const maskIndex = flatShaderCode.indexOf("radius > 1.0");
    expect(sampleIndex).toBeGreaterThan(-1);
    expect(maskIndex).toBeGreaterThan(-1);
    expect(sampleIndex).toBeLessThan(maskIndex);
    expect(flatShaderCode).not.toContain("if (radius > 1.0)");
  });

  test("derives fisheye guide angles through the inverse portable kernel", () => {
    expect(flatShaderCode).toContain("fn sourceUvToDirectionKernel");
    expect(flatShaderCode).toContain("let directionSample = sourceUvToDirectionKernel(");
    expect(flatShaderCode).toContain("let theta = acos(centerDot)");
    expect(flatShaderCode).toContain("uniforms.kernel.centerAxis");
    expect(flatShaderCode).not.toContain("fn carrierRadiusToPhysicalRadius");
  });

  test("routes surface-carrier guide branches through explicit topology identity", () => {
    expect(flatShaderCode).toContain("uniforms.kernel.topology == 3u");
    expect(flatShaderCode).toContain("uniforms.kernel.topology == 2u");
    expect(flatShaderCode).toContain("uniforms.kernel.topology == 1u");
    expect(flatShaderCode).not.toContain("carrierObserver.w >");
    expect(flatShaderCode).not.toContain("sourceCenterTheta.w <");
  });

  test("shows exact square-carrier wall corners only through the Edge flag", () => {
    expect(flatShaderCode).toContain("let wallCornerDistance = abs(abs(carrierLocal.x) - abs(carrierLocal.y))");
    expect(flatShaderCode).toContain("wallMask * uniforms.showSourceCircle");
    expect(flatShaderCode).toContain("boundary), wallCorners)");
  });
});

describe("CAVE projection shader", () => {
  test("maps room surfaces and source UVs through portable TypeGPU kernels", () => {
    expect(caveShaderCode).toContain("fn caveContinuityDirectionFromSurfaceKernel");
    expect(caveShaderCode).toContain("fn sourceDirectionToUvKernel");
    expect(caveShaderCode).toContain(
      "return caveContinuityDirectionFromSurfaceKernel(point, uniforms.kernel.boxSize, uniforms.kernel.boxObserver)",
    );
    expect(caveShaderCode).toContain("var continuityPhysicalDir = continuityPhysicalDirectionFromCavePoint");
    expect(caveShaderCode).toContain("surfaceTopY = planarHallRoofHeightKernel");
    expect(caveShaderCode).toContain("fn planarRoofNearestInteriorAnchorDistanceKernel");
    expect(caveShaderCode).toContain("capSeam = (1.0 - smoothstep");
    expect(caveShaderCode).toContain("abs(in.world.y - surfaceTopY)");
    expect(caveShaderCode).toContain("abs(in.world.y - bottomY)");
    expect(caveShaderCode).toContain("profileDistance = planarRoofNearestInteriorAnchorDistanceKernel");
    expect(caveShaderCode).toContain("profileDistance)) * uniforms.showSourceCircle");
    expect(caveShaderCode).toContain("edgeLine(in.faceUv.y)) * uniforms.showSourceCircle");
    expect(caveShaderCode).toContain("fn planarRoofSegmentSlopeKernel");
    expect(caveShaderCode).toContain("faceIndex - 4.0");
    expect(caveShaderCode).not.toContain("uniforms.kernel.doubleGable.z");
    expect(caveShaderCode).toContain("textureSampleLevel(sourceTexture, sampler");
  });
});

describe("cylinder projection shader", () => {
  test("maps the projected surface through explicit cylinder kernel parameters", () => {
    expect(cylinderShaderCode).toContain("fn directionToCylinderRadialUvKernel");
    expect(cylinderShaderCode).toContain("fn directionToCylinderWallUvKernel");
    expect(cylinderShaderCode).toContain("let sourceSample = sourceDirectionToUvKernel(");
    expect(cylinderShaderCode).toContain("uniforms.kernel.cylinder");
    expect(cylinderShaderCode).toContain("uniforms.kernel.mode == 5u");
    expect(cylinderShaderCode).toContain("uniforms.kernel.topology == 3u");
    expect(cylinderShaderCode).not.toContain("carrierObserver.w >");
  });

  test("keeps cap-detail selection and excludes the wall unwrap cap mesh", () => {
    expect(cylinderShaderCode).toContain("@group(0) @binding(4) var capDetailTexture");
    expect(cylinderShaderCode).toContain("uniforms.sourceOverlay.y > 0.5");
    expect(cylinderShaderCode).toContain("if (isUnwrapped && in.face > 0.5)");
    expect(cylinderShaderCode).toContain("let mappedSurface = select(1.0, sourceSample.z, isUnwrapped)");
  });
});
