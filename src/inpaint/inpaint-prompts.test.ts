import { describe, expect, it } from "vitest";
import { cloneDefaultDomeScene } from "../lib/shared/contracts/dome-scene.js";
import { carrierRasterForAspect } from "../lib/shared/contracts/projection-authoring.js";
import {
  compileRepairPromptForProjectionSnapshot,
  inpaintPromptForProjection,
  shouldReplaceWithProjectionInpaintPrompt,
} from "./inpaint-prompts.js";

describe("projection inpaint prompts", () => {
  it.each([
    "zenith-180",
    "zenith-230",
    "nadir-180",
    "cave-270",
    "hall-double-gable",
    "cylinder-nadir",
    "cylinder-zenith",
  ] as const)("integrates anchored plate content by default for %s", (mode) => {
    const prompt = inpaintPromptForProjection(mode);
    expect(prompt).toContain("ZENITH ANCHORED PLATE INTEGRATION CONTRACT v4");
    expect(prompt).toContain("ANCHORED REGION OF INTENT");
    expect(prompt).toContain("BOUNDARY PERMEABILITY");
    expect(prompt).toContain("Harmonize inward into the source plate as well as outward");
    expect(prompt).toContain("The original plate silhouette");
    expect(prompt).toContain("literal pixels are not sacred");
    expect(prompt).toContain("PLACEMENT TOLERANCE");
    expect(prompt).toContain("FROZEN DIRECTIONAL CARRIER SEGMENTATION — DECODE BEFORE INPAINTING");
    expect(prompt).toContain("ANCHORED INTEGRATION EXECUTION — FOLLOW IN THIS ORDER");
    expect(prompt).toContain("INTEGRATE INWARD AND OUTWARD");
    expect(prompt).toContain("DISSOLVE OLD SILHOUETTES");
    expect(prompt).toContain("no old bounding box");
    expect(prompt.length).toBeLessThan(32_000);
  });

  it("retains strict pixel copy-through as an explicit archival strategy", () => {
    const prompt = inpaintPromptForProjection("zenith-230", undefined, undefined, undefined, "strict");
    expect(prompt).toContain("ZENITH MASKED SEMANTIC INPAINT CONTRACT v3");
    expect(prompt).toContain("Color alone never makes a pixel editable");
    expect(prompt).toContain("COPY-THROUGH RULE");
    expect(prompt).toContain("Zero optical flow, zero displacement, zero resampling, and zero diffusion");
    expect(prompt).toContain("place the unchanged copied artwork layer back over the generated fill");
  });

  it("compiles an authored layer-position ledger and subordinate artist direction", () => {
    const raster = carrierRasterForAspect("1:1");
    const frame = {
      plateFit: "contain" as const,
      plateFeather: 0.02,
      activeLayerId: "plate-1",
      plateLayers: [
        {
          id: "plate-1",
          name: "Plate 1",
          index: 0,
          source: { name: "source.png", width: 1024, height: 768, aspect: 4 / 3 },
          placement: {
            azimuth: 45,
            radius: 0.5,
            scale: 0.42,
            spin: 0,
            opacity: 1,
            flipX: false,
            flipY: false,
            cornerOffsets: {
              nw: { x: 0, y: 0 },
              ne: { x: 0, y: 0 },
              se: { x: 0, y: 0 },
              sw: { x: 0, y: 0 },
            },
          },
          visible: true,
          locked: false,
        },
      ],
    };
    const snapshot = {
      projectionMode: "hall-double-gable" as const,
      guideSplit: 0.36,
      horizonSplit: 0.68,
      raster,
      surface: {
        kind: "double-gable-room" as const,
        length: 22.55,
        width: 23.143,
        eaveHeight: 9.39,
        ridgeHeight: 12.93,
        valleyHeight: 9.39,
        ridgeInset: 5.78575,
        eyeHeight: 1.7,
        eyeX: 0,
        eyeZ: 0,
      },
      frame,
    };
    const prompt = compileRepairPromptForProjectionSnapshot(
      inpaintPromptForProjection("zenith-180"),
      snapshot,
      "Continue the wetland with sparse luminous flowers and fine glass filaments.",
    );

    expect(prompt).toContain("ANCHORED PLATE LEDGER");
    expect(prompt).toContain("Layer 1: source 1024×768 (1.333); authored center x=");
    expect(prompt).toContain("center carrier band");
    expect(prompt).toContain("rotation 0 degrees");
    expect(prompt).toContain("ARTIST DIRECTION — SUBJECT, MATERIAL, ATMOSPHERE, AND CONTINUITY");
    expect(prompt).toContain("Continue the wetland with sparse luminous flowers");
    expect(prompt).toContain("inside the anchored integration contract");
  });

  it("assigns original Plate sources appearance-only roles without surrendering Plate Sketch placement", () => {
    const scene = cloneDefaultDomeScene();
    scene.frame0.plateLayers = [
      {
        id: "plate-a",
        name: "Translucent macro A",
        index: 0,
        source: {
          assetId: "asset-a",
          name: "macro-a.webp",
          width: 700,
          height: 700,
          aspect: 1,
          mime: "image/webp",
        },
        placement: {
          azimuth: -70,
          radius: 0.54,
          scale: 0.9,
          spin: 0,
          opacity: 1,
          flipX: false,
          flipY: false,
          cornerOffsets: {
            nw: { x: 0, y: 0 },
            ne: { x: 0, y: 0 },
            se: { x: 0, y: 0 },
            sw: { x: 0, y: 0 },
          },
        },
        visible: true,
        locked: false,
      },
      {
        id: "plate-b",
        name: "Translucent macro B",
        index: 1,
        source: {
          assetId: "asset-b",
          name: "macro-b.webp",
          width: 1024,
          height: 1024,
          aspect: 1,
          mime: "image/webp",
        },
        placement: {
          azimuth: 80,
          radius: 0.49,
          scale: 1.07,
          spin: 0.87,
          opacity: 1,
          flipX: false,
          flipY: false,
          cornerOffsets: {
            nw: { x: 0, y: 0 },
            ne: { x: 0, y: 0 },
            se: { x: 0, y: 0 },
            sw: { x: 0, y: 0 },
          },
        },
        visible: true,
        locked: false,
      },
    ];

    const prompt = inpaintPromptForProjection("zenith-180", scene.guideSplit, scene.horizonSplit, {
      raster: scene.raster,
      surface: scene.surface,
      frame: scene.frame0,
    });

    expect(prompt).toContain("SOURCE APPEARANCE REFERENCES — CONTENT AUTHORITY, NEVER POSITION AUTHORITY");
    expect(prompt).toContain("Image 2 / @source_1 is the original unwarped appearance reference for Layer 1");
    expect(prompt).toContain("Image 3 / @source_2 is the original unwarped appearance reference for Layer 2");
    expect(prompt).toContain("macro-a.webp, 700×700");
    expect(prompt).toContain("@plate_sketch alone determines where, how large, and with what warp");
    expect(prompt).toContain("If they are macro, abstract, liquid, translucent");
    expect(prompt).toContain("Never reinterpret ambiguous green, blue, reflective, organic, or glass-like matter");
    expect(prompt).toContain("This label encodes geometry only and supplies no subject matter");
    expect(prompt).not.toContain("synthesize only sky / overhead continuity");

    const strict = inpaintPromptForProjection(
      "zenith-180",
      scene.guideSplit,
      scene.horizonSplit,
      { raster: scene.raster, surface: scene.surface, frame: scene.frame0 },
      "strict",
    );
    expect(strict).not.toContain("@source_1");
  });

  it("wraps a legacy custom repair prompt as artist direction instead of bypassing the spatial harness", () => {
    const scene = cloneDefaultDomeScene();
    const prompt = compileRepairPromptForProjectionSnapshot("Keep the flowers sparse and pale.", {
      projectionMode: scene.projectionMode,
      guideSplit: scene.guideSplit,
      horizonSplit: scene.horizonSplit,
      raster: scene.raster,
      surface: scene.surface,
      frame: scene.frame0,
    });

    expect(prompt).toContain("ZENITH ANCHORED PLATE INTEGRATION CONTRACT v4");
    expect(prompt).toContain("ARTIST DIRECTION — SUBJECT, MATERIAL, ATMOSPHERE, AND CONTINUITY");
    expect(prompt).toContain("Keep the flowers sparse and pale.");
  });

  it("explains the continuous no-floor planar-profile shell", () => {
    const prompt = inpaintPromptForProjection("hall-double-gable", 0.36, 0.68);
    expect(prompt.startsWith("ZENITH HALL CARRIER EDIT — SURGICAL 2D TEXTURE INPAINT")).toBe(true);
    expect(prompt).toContain("integrate each plate according to the selected preservation contract");
    expect(prompt).toContain("The original crop silhouette is not sacred");
    expect(prompt).toContain("Repaint inward and outward across it");
    expect(prompt).toContain("It must not look like a plausible camera view");
    expect(prompt).toContain("no central vanishing point, central back wall, rectangular opening");
    expect(prompt).toContain("no bilateral, radial, fourfold, mirrored, repeated, or kaleidoscopic composition");
    expect(prompt).toContain("rho 0 to 36% is the continuous 4-plane roof allocation");
    expect(prompt).toContain("rho 68% is the eye-level allocation anchor");
    expect(prompt).toContain("this carrier contains no floor pixels");
    expect(prompt).toContain(
      "blue-to-aqua bands inside the roof allocation encode the cross-hall roof-height function H(z)",
    );
    expect(prompt).toContain("roof profile varies only across hall width");
    expect(prompt).toContain("extruded unchanged along hall length");
    expect(prompt).toContain("same local carrier neighborhood");
    expect(prompt).toContain("original crop boundary should no longer be detectable");
    expect(shouldReplaceWithProjectionInpaintPrompt(prompt)).toBe(true);
  });

  it("uses runtime-normalized hall anchors and geometry-derived roof roles", () => {
    const prompt = inpaintPromptForProjection("hall-double-gable", 0.68, 0.69, {
      raster: carrierRasterForAspect("1:1"),
      surface: {
        kind: "double-gable-room",
        length: 18,
        width: 12,
        eaveHeight: 10,
        ridgeHeight: 8,
        valleyHeight: 9,
        ridgeInset: 7,
        roofProfile: [
          { id: "left", position: 0, height: 7, role: "ridge" },
          { id: "high", position: 0.3, height: 11, role: "valley" },
          { id: "slope", position: 0.62, height: 9, role: "ridge" },
          { id: "right", position: 1, height: 7.5, role: "break" },
        ],
        eyeHeight: 1.7,
        eyeX: 1,
        eyeZ: -0.5,
      },
    });

    expect(prompt).toContain("rho 72% is the eye-level allocation anchor");
    expect(prompt).toContain("eave at 0% cross-hall / 7 m");
    expect(prompt).toContain("ridge at 30% cross-hall / 11 m");
    expect(prompt).toContain("break at 62% cross-hall / 9 m");
    expect(prompt).toContain("eave at 100% cross-hall / 7.5 m");
  });

  it("keeps nadir inpaint prompts aligned with floor-centered source language", () => {
    expect(inpaintPromptForProjection("nadir-180")).toContain("bottom-facing equidistant 180 fisheye");
    expect(inpaintPromptForProjection("nadir-180")).toContain("inner disk is the downward directional band");
    expect(inpaintPromptForProjection("cave-270")).toContain("exact projection-source carrier map");
    expect(inpaintPromptForProjection("cave-270")).toContain(
      "warped source texture for an immersive projection surface",
    );
    expect(inpaintPromptForProjection("cave-270")).toContain("center region represents floor-source content");
    expect(inpaintPromptForProjection("cave-270")).toContain("currently occupies 33% of the source-map radius");
    expect(inpaintPromptForProjection("cave-270", 0.5)).toContain("currently occupies 50% of the source-map radius");
    expect(inpaintPromptForProjection("cave-270", 0.5, 0.62)).toContain("eye-level/horizon breakpoint at 62%");
    expect(inpaintPromptForProjection("cave-270")).toContain(
      "moving outward from the center means moving from floor surface into vertical perimeter surfaces",
    );
    expect(inpaintPromptForProjection("cave-270")).toContain("outer raster boundary represents the upper edge");
    expect(inpaintPromptForProjection("cave-270")).toContain(
      "angular direction around the center corresponds to direction around the room perimeter",
    );
    expect(inpaintPromptForProjection("cave-270")).toContain("continuous green-to-cyan-to-blue color field");
    expect(inpaintPromptForProjection("cave-270")).toContain("square carrier radius rho=max(abs(2x-1), abs(2y-1))");
    expect(inpaintPromptForProjection("cave-270")).toContain("Band 1 / DOWNWARD_DIRECTION: coordinate 0% to 33.3%");
    expect(inpaintPromptForProjection("cave-270")).toContain("Band 2 / LOWER_PERIMETER: coordinate 33.3% to 66.7%");
    expect(inpaintPromptForProjection("cave-270")).toContain("Band 3 / UPPER_PERIMETER: coordinate 66.7% to 100%");
    expect(inpaintPromptForProjection("cave-270")).toContain(
      "A plate touching one zone may seed generated texture in that zone",
    );
    expect(inpaintPromptForProjection("cave-270")).toContain(
      "Never relocate or repurpose a plate to make it cover a different semantic zone",
    );
    expect(inpaintPromptForProjection("cave-270")).toContain("first authored color stop");
    expect(inpaintPromptForProjection("cave-270")).toContain("second authored color stop");
    expect(inpaintPromptForProjection("cave-270")).toContain("without drawing radial construction lines");
    expect(inpaintPromptForProjection("cave-270", 0.5)).toContain("floor-to-wall anchor is 50% from the center");
    expect(inpaintPromptForProjection("cave-270")).toContain("Keep the recognizable content");
    expect(inpaintPromptForProjection("cave-270")).toContain(
      "floor-to-wall transition must become invisible finished image content",
    );
    expect(inpaintPromptForProjection("cave-270")).toContain("one clean opaque warped projection-source texture");
    expect(inpaintPromptForProjection("cave-270")).not.toMatch(
      /coordinate semantics|vanishing-point perspective.*sky opening|visualization of the room/i,
    );
    expect(inpaintPromptForProjection("nadir-180")).not.toMatch(/fulldome|domemaster|zenith at the center/i);
    expect(inpaintPromptForProjection("cave-270")).not.toMatch(/fulldome|domemaster|zenith at the center/i);
    expect(inpaintPromptForProjection("cave-270")).not.toMatch(/CAVE|visual continuity reference|lower world/i);
  });

  it("describes the positional field independently from toggleable diagnostic overlays", () => {
    for (const mode of ["zenith-180", "zenith-230", "nadir-180"] as const) {
      expect(inpaintPromptForProjection(mode)).toContain("@plate_sketch");
      expect(inpaintPromptForProjection(mode)).not.toContain("@PlateSketch");
      expect(inpaintPromptForProjection(mode)).toMatch(/continuous cyan-to-green positional field/i);
      expect(inpaintPromptForProjection(mode)).toMatch(/authored color stops mark semantic anchors/i);
      expect(inpaintPromptForProjection(mode)).not.toMatch(/black rings, spokes/i);
      expect(inpaintPromptForProjection(mode)).toMatch(/black area outside the circular projection black/i);
      expect(inpaintPromptForProjection(mode)).toContain(
        "aqua/green guide fill marks missing pixels allocated to human-level projection directions",
      );
    }
    expect(inpaintPromptForProjection("zenith-180")).toContain(
      "cyan/blue guide fill marks missing pixels allocated to overhead projection directions",
    );
    expect(inpaintPromptForProjection("zenith-180")).not.toContain("neon green guide fill marks missing floor");
    expect(inpaintPromptForProjection("zenith-230")).toContain(
      "cyan/blue guide fill marks missing pixels allocated to overhead projection directions",
    );
    expect(inpaintPromptForProjection("zenith-230")).toContain(
      "neon green guide fill marks missing pixels allocated below the viewing horizon",
    );
    expect(inpaintPromptForProjection("nadir-180")).toContain(
      "cyan/blue guide fill marks missing pixels allocated to overhead projection directions",
    );
    expect(inpaintPromptForProjection("nadir-180")).toContain(
      "neon green guide fill marks missing pixels allocated below the viewing horizon",
    );
    expect(inpaintPromptForProjection("zenith-180")).toContain("outer field is the human-level directional band");
    expect(inpaintPromptForProjection("zenith-230")).toContain("outer annulus is the below-horizon band");
    expect(inpaintPromptForProjection("nadir-180")).toContain("outer field approaches human-level directions");
    expect(inpaintPromptForProjection("zenith-180")).toContain("33% from the center");
    expect(inpaintPromptForProjection("zenith-180", 0.5)).toContain("50% from the center");
    expect(inpaintPromptForProjection("cave-270")).toContain("@plate_sketch");
    expect(inpaintPromptForProjection("cave-270")).toMatch(/Replace the complete positional field/i);
    expect(inpaintPromptForProjection("cave-270")).toMatch(/no green, no cyan\/blue, no black guide lines/i);
    expect(inpaintPromptForProjection("cave-270")).not.toMatch(/black area outside the circular projection black/i);
  });

  it("describes zenith 230 as a 25-degree below-horizon extension", () => {
    expect(inpaintPromptForProjection("zenith-230")).toContain("equidistant 230 fulldome map");
    expect(inpaintPromptForProjection("zenith-230")).toContain("physical horizon direction remapped");
    expect(inpaintPromptForProjection("zenith-230", 1 / 3, 0.7)).toContain("second guide boundary at 70%");
    expect(inpaintPromptForProjection("zenith-230")).toContain("25 degrees below the horizon");
  });

  it.each([
    ["cylinder-nadir", "floor", "top edge"],
    ["cylinder-zenith", "ceiling", "bottom edge"],
  ] as const)("describes %s as a continuous cylinder source map", (mode, cap, rim) => {
    const prompt = inpaintPromptForProjection(mode);
    expect(prompt).toContain("cylinder continuity-source map using the prescribed full-frame raster");
    expect(prompt).toContain("normalized circular cylinder domain");
    expect(prompt).toContain("continuous 360-degree cylindrical projection surface");
    expect(prompt).toContain(`tiny inner disk from the center to 2%`);
    expect(prompt).toContain(`${cap} cap`);
    expect(prompt).toContain(`wall ${rim}`);
    expect(prompt).toContain("exterior outside the source circle");
    expect(prompt).toContain("must remain pure black");
    expect(prompt).not.toMatch(/CAVE|domemaster/i);
  });

  it("describes the wall unwrap as a full rectangular seam-identified carrier", () => {
    const prompt = inpaintPromptForProjection("cylinder-wall", 0.62, undefined, {
      raster: carrierRasterForAspect("21:9"),
      surface: { kind: "cylinder", radius: 3.2, height: 6.4, eyeHeight: 1.7 },
    });
    expect(prompt).toContain("21:9 equirectangular 360-degree cylinder-wall texture");
    expect(prompt).toContain("ZENITH CYLINDER-WALL EDIT CONTRACT v3");
    expect(prompt).toContain("EDIT IMAGE 1 / @plate_sketch IN PLACE");
    expect(prompt).toContain("detailed authored plate content");
    expect(prompt).toContain("smooth cyan/blue/green positional guide field");
    expect(prompt).toContain("left and right raster edges meet at the same physical vertical seam");
    expect(prompt).toContain("x=0% and x=100% are the identified back seam");
    expect(prompt).toContain("every horizontal scanline is one closed ring");
    expect(prompt).toContain("PROTECTED PERIODIC SEAM CORRIDOR");
    expect(prompt).toContain(
      "last raster column x=2911 and first raster column x=0 are consecutive neighboring samples",
    );
    expect(prompt).toContain("one pixel step apart, not duplicate samples and not unrelated image margins");
    expect(prompt).toContain("high-fidelity seam evidence");
    expect(prompt).toContain("one wrap-crossing plate");
    expect(prompt).toContain("last 10% of the right edge and first 10% of the left edge");
    expect(prompt).toContain("already registered 2912×1248 equirectangular wall chart");
    expect(prompt).toContain("Tile three identical, unscaled copies horizontally");
    expect(prompt).toContain("transition x=2911→0");
    expect(prompt).toContain("ordinary local transitions x=2910→2911 and x=0→1");
    expect(prompt).not.toContain("paired samples of the same vertical cut");
    expect(prompt).not.toContain("must match exactly in color");
    expect(prompt).not.toContain("last 8% of the right edge");
    expect(prompt).toContain("A flat 360-degree equirectangular wall panorama is the required output topology");
    expect(prompt).toContain("complete rectangular raster is the unwrapped cylindrical wall");
    expect(prompt).toContain("62% of the bottom-to-top carrier traversal");
    expect(prompt).toContain("there is no floor or ceiling cap");
    expect(prompt).toContain("there is no circular mask or black exterior");
    expect(prompt).not.toContain("ZENITH ANCHORED PLATE INTEGRATION CONTRACT v4");
    expect(prompt).not.toContain("full-frame ellipse");
  });

  it("defaults cylinder-wall prompt generation to the governed 21:9 carrier", () => {
    const prompt = inpaintPromptForProjection("cylinder-wall");

    expect(prompt).toContain("@plate_sketch is itself 2912 × 1248 pixels");
    expect(prompt).toContain("returned image must also be exactly 2912 × 1248 pixels");
    expect(prompt).toContain("Return only the finished 21:9 equirectangular wall texture");
  });

  it("names authored layers that cross the cylinder-wall periodic cut", () => {
    const scene = cloneDefaultDomeScene();
    scene.frame0.plateLayers.push({
      id: "plate-edge",
      name: "Edge Garden",
      index: 0,
      source: { name: "edge-garden.png", width: 2048, height: 1536, aspect: 4 / 3 },
      placement: {
        azimuth: 179,
        radius: 0.5,
        scale: 0.72,
        spin: 0,
        opacity: 1,
        flipX: false,
        flipY: false,
        cornerOffsets: {
          nw: { x: 0, y: 0 },
          ne: { x: 0, y: 0 },
          se: { x: 0, y: 0 },
          sw: { x: 0, y: 0 },
        },
      },
      visible: true,
      locked: false,
    });

    const prompt = inpaintPromptForProjection("cylinder-wall", 0.62, undefined, {
      raster: carrierRasterForAspect("21:9"),
      surface: { kind: "cylinder", radius: 3.2, height: 6.4, eyeHeight: 1.7 },
      frame: scene.frame0,
    });

    expect(prompt).toContain("CONFIRMED SEAM-CROSSING LAYERS");
    expect(prompt).toContain("Layer 1 crosses the periodic cut");
    expect(prompt).toContain("visible left-edge and right-edge fragments are clipped portions of this one");
    expect(prompt).toContain("Do not complete either fragment as a separate plant");
  });

  it("carries exact rectangular raster and measured surface geometry into generated prompts", () => {
    const cavePrompt = inpaintPromptForProjection("cave-270", 0.4, 0.7, {
      raster: carrierRasterForAspect("16:9"),
      surface: {
        kind: "box-room",
        width: 8.5,
        depth: 5.25,
        height: 3.75,
        eyeHeight: 1.62,
        eyeX: -0.4,
        eyeZ: 0.8,
      },
    });
    expect(cavePrompt).toContain("exactly 2560 × 1440 pixels (16:9, full-frame carrier)");
    expect(cavePrompt).toContain("width 8.5 m, depth 5.25 m, height 3.75 m");
    expect(cavePrompt).toContain(
      "authored texture-horizon height 1.62 m above the venue floor; observer pose Y 1.62 m, X -0.4 m, Z 0.8 m",
    );
    expect(cavePrompt).toContain("square-perimeter room carrier spans the complete rectangular raster");
    expect(cavePrompt).not.toMatch(/square (image|raster)/i);
    expect(shouldReplaceWithProjectionInpaintPrompt(cavePrompt)).toBe(true);

    const cylinderPrompt = inpaintPromptForProjection("cylinder-nadir", undefined, undefined, {
      raster: carrierRasterForAspect("9:16"),
      surface: { kind: "cylinder", radius: 3.2, height: 6.4, eyeHeight: 1.7 },
    });
    expect(cylinderPrompt).toContain("exactly 1440 × 2560 pixels (9:16, full-frame carrier)");
    expect(cylinderPrompt).toContain(
      "radius 3.2 m, diameter 6.4 m, height 6.4 m; authored texture-horizon height 1.7 m above the venue floor; observer pose Y 1.7 m",
    );
    expect(cylinderPrompt).toContain("full-frame ellipse touching all four edge midpoints");
    expect(cylinderPrompt).toContain("do not replace it with a min-side pixel circle");
  });

  it("keeps rectangular angular carriers circular in pixel space", () => {
    const prompt = inpaintPromptForProjection("zenith-180", undefined, undefined, {
      raster: carrierRasterForAspect("21:9"),
      surface: { kind: "angular" },
    });

    expect(prompt).toContain("true pixel circle whose diameter is the raster's short edge");
    expect(prompt).toContain("protected black margins along the long axis");
    expect(prompt).toContain("do not stretch it into an ellipse");
  });

  it("replaces only known obsolete generated prompt scaffolds", () => {
    expect(
      shouldReplaceWithProjectionInpaintPrompt(
        "Use @PlateSketch as a visual continuity reference for a square nadir-centered equidistant 270 fisheye map intended for CAVE floor and wall extraction.",
      ),
    ).toBe(true);
    expect(
      shouldReplaceWithProjectionInpaintPrompt(
        "Use @PlateSketch as an exact square domemaster guide. It is an equidistant 270 fulldome map with the nadir at the center, the horizon at two-thirds of the projection radius.",
      ),
    ).toBe(true);
    expect(
      shouldReplaceWithProjectionInpaintPrompt(
        "Use @PlateSketch as an exact square domemaster guide. It is an equidistant 180 fulldome map with the zenith at the center and the horizon at the outer circle.",
      ),
    ).toBe(true);
    expect(
      shouldReplaceWithProjectionInpaintPrompt(
        "Use @plate_sketch as the exact square domemaster composition handoff for inpaint. It is the source of truth for plate placement, scale, orientation, fisheye geometry, projection center, rim continuity, and the black exterior outside the projection circle.",
      ),
    ).toBe(true);
    expect(
      shouldReplaceWithProjectionInpaintPrompt(
        "Use @plate_sketch as an exact square CAVE 270 source-map guide. It is a flat projection source map, not a perspective room render. Preserve the existing plate content, orientation, scale, and source-map geometry.",
      ),
    ).toBe(true);
    expect(
      shouldReplaceWithProjectionInpaintPrompt(
        "Use @plate_sketch as a square CAVE 270 continuity-carrier map for inpainting, not as a camera photograph or room render. Keep the exact source-map layout. Visual harness: the center is the floor center.",
      ),
    ).toBe(true);
    expect(
      shouldReplaceWithProjectionInpaintPrompt("Keep this custom inpaint prompt for my own CAVE experiment."),
    ).toBe(false);
  });
});
