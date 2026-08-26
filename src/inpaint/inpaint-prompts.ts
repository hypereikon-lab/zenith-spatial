import { CAVE_HANDOFF_GUIDE, caveGuideHorizonBand, caveGuidePromptClause } from "../geometry/cave-handoff-guide.js";
import { domeGuidePromptClause } from "../geometry/dome-handoff-guide.js";
import {
  normalizeSourceGuideCarrierHorizonRadius,
  normalizeSourceInnerGuideSplit,
  sourceGuideZones,
  type SourceGuideZone,
} from "../geometry/source-guide-semantics.js";
import { sourceMapPointToUv, type SourceProjectionMode } from "../geometry/source-projection.js";
import type { DomeSceneFrame0 } from "../lib/shared/contracts/dome-scene.js";
import {
  carrierRasterForAspect,
  carrierRasterForProjection,
  defaultProjectionSurface,
  normalizeProjectionSurfaceForMode,
  planarRoofProfile,
  projectionSpatialAnchors,
  projectionSurfaceHorizonCalibrationOffset,
  type CarrierRaster,
  type ProjectionSurface,
} from "../lib/shared/contracts/projection-authoring.js";
import { inpaintSourceReferenceDescriptors } from "./inpaint-source-references.js";

export type InpaintProjectionPromptGeometry = {
  raster: CarrierRaster;
  surface: ProjectionSurface;
  frame?: DomeSceneFrame0;
};

export type InpaintProjectionPromptSnapshot = {
  projectionMode: SourceProjectionMode;
  guideSplit: number;
  horizonSplit: number;
  raster: CarrierRaster;
  surface?: ProjectionSurface;
  frame?: DomeSceneFrame0;
};

const INPAINT_GUIDE_PROMPT = `Treat the continuous cyan-to-green positional field inside the projection circle as missing pixels to fill, not artwork, lighting, atmosphere, or an object. Its color changes encode smooth spatial traversal and its authored color stops mark semantic anchors. Remove the field completely while preserving its continuity. Keep the pure black area outside the circular projection black.`;
const NADIR_INPAINT_GUIDE_PROMPT = `This is a bottom-facing nadir fisheye repair guide, not a zenith dome view. The center of the circle is the downward projection direction directly below the viewer. It does not require literal floor, ground, or terrain; continue the source-derived visual medium there. Do not reinterpret it as sky, clouds, sun, ceiling, treetops, or overhead canopy. ${INPAINT_GUIDE_PROMPT}`;
const HALL_CARRIER_EDIT_MARKER = "ZENITH HALL CARRIER EDIT";
const INTEGRATED_PLATE_EDIT_MARKER = "ZENITH ANCHORED PLATE INTEGRATION CONTRACT v4";
const PIXEL_LOCK_EDIT_MARKER = "ZENITH MASKED SEMANTIC INPAINT CONTRACT v3";

export const PLATE_INTEGRATION_MODES = ["integrated", "strict"] as const;
export type PlateIntegrationMode = (typeof PLATE_INTEGRATION_MODES)[number];
export const DEFAULT_PLATE_INTEGRATION_MODE: PlateIntegrationMode = "integrated";
export const DEFAULT_INPAINT_PROMPT = zenith180InpaintPrompt();
export const INPAINT_PROJECTION_PROMPTS = {
  "zenith-180": DEFAULT_INPAINT_PROMPT,
  "zenith-230": zenith230InpaintPrompt(),
  "nadir-180": nadir180InpaintPrompt(),
  "cave-270": cave270InpaintPrompt(),
  "hall-double-gable": doubleGableHallInpaintPrompt(),
  "cylinder-nadir": cylinderInpaintPrompt("cylinder-nadir"),
  "cylinder-zenith": cylinderInpaintPrompt("cylinder-zenith"),
  "cylinder-wall": cylinderWallInpaintPrompt(),
} as const;

const OBSOLETE_GENERATED_INPAINT_PROMPT_MARKERS = [
  "visual continuity reference",
  "intended for CAVE",
  "Infer the lower hemisphere",
  "Infer the lower world",
  "including upper sky/ceiling directions",
  "do not stretch sky texture into the floor",
  "smeared projection damage",
  "No visible white patches, mask edges, checkerboards, dividers, radial spokes, central holes, or repair boundaries.",
  "Faint projection rings and spokes",
  "No visible white patches, mask edges, checkerboards, dividers, central holes, or repair boundaries.",
  "equidistant 180 fulldome map with the nadir at the center",
  "equidistant 270 fulldome map with the nadir at the center",
  "exact square domemaster composition handoff for inpaint",
  "exact square CAVE 270 source-map guide",
  "black square bands and spokes",
  "coherent continuation of the same flat source texture",
  "Do not create visible room corners",
  "square CAVE 270 continuity-carrier map",
  "Output a clean opaque square CAVE 270 source-map image",
];

export function inpaintPromptForProjection(
  mode: SourceProjectionMode,
  domeGuideSemanticSplit?: number | string | null,
  domeGuideHorizonSplit?: number | string | null,
  geometry?: InpaintProjectionPromptGeometry,
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  const promptGeometry = normalizePromptGeometry(mode, geometry);
  if (mode === "zenith-230") {
    return zenith230InpaintPrompt(domeGuideSemanticSplit, domeGuideHorizonSplit, promptGeometry, plateIntegrationMode);
  }
  if (mode === "nadir-180") {
    return nadir180InpaintPrompt(domeGuideSemanticSplit, promptGeometry, plateIntegrationMode);
  }
  if (mode === "cave-270") {
    return cave270InpaintPrompt(domeGuideSemanticSplit, domeGuideHorizonSplit, promptGeometry, plateIntegrationMode);
  }
  if (mode === "hall-double-gable") {
    return doubleGableHallInpaintPrompt(
      domeGuideSemanticSplit,
      domeGuideHorizonSplit,
      promptGeometry,
      plateIntegrationMode,
    );
  }
  if (mode === "cylinder-nadir" || mode === "cylinder-zenith") {
    return cylinderInpaintPrompt(
      mode,
      domeGuideSemanticSplit,
      domeGuideHorizonSplit,
      promptGeometry,
      plateIntegrationMode,
    );
  }
  if (mode === "cylinder-wall") {
    return cylinderWallInpaintPrompt(domeGuideSemanticSplit, promptGeometry, plateIntegrationMode);
  }
  return zenith180InpaintPrompt(domeGuideSemanticSplit, promptGeometry, plateIntegrationMode);
}

/**
 * Resolves the repair prompt against one immutable Plate Composition geometry.
 * Generated Zenith scaffolds follow that geometry; genuinely authored prompts
 * remain verbatim.
 */
export function repairPromptForProjectionSnapshot(
  currentPrompt: string,
  snapshot: InpaintProjectionPromptSnapshot,
): string {
  if (!shouldReplaceWithProjectionInpaintPrompt(currentPrompt)) return currentPrompt;
  return inpaintPromptForProjection(snapshot.projectionMode, snapshot.guideSplit, snapshot.horizonSplit, {
    raster: snapshot.raster,
    surface: normalizeProjectionSurfaceForMode(snapshot.surface, snapshot.projectionMode),
    frame: snapshot.frame,
  });
}

/**
 * Builds the exact paid-image prompt while keeping artist direction subordinate
 * to the immutable Plate Sketch coordinate contract. Older projects that stored
 * a custom sentence in `repair` retain it as artist direction instead of losing
 * the spatial harness entirely.
 */
export function compileRepairPromptForProjectionSnapshot(
  currentPrompt: string,
  snapshot: InpaintProjectionPromptSnapshot,
  artistDirection = "",
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  const generatedHarness = inpaintPromptForProjection(
    snapshot.projectionMode,
    snapshot.guideSplit,
    snapshot.horizonSplit,
    {
      raster: snapshot.raster,
      surface: normalizeProjectionSurfaceForMode(snapshot.surface, snapshot.projectionMode),
      frame: snapshot.frame,
    },
    plateIntegrationMode,
  );
  const legacyDirection = shouldReplaceWithProjectionInpaintPrompt(currentPrompt) ? "" : currentPrompt.trim();
  const direction = artistDirection.trim() || legacyDirection;
  if (!direction) return generatedHarness;

  return `${generatedHarness}

ARTIST DIRECTION — SUBJECT, MATERIAL, ATMOSPHERE, AND CONTINUITY
${direction}

The artist direction controls subject, material, atmosphere, and continuity inside the anchored integration contract. It never authorizes abandoning a plate's principal content or placement, and never changes the carrier raster or projection topology.`;
}

export function shouldReplaceWithProjectionInpaintPrompt(prompt: string): boolean {
  const currentPrompt = prompt.trim();
  if (!currentPrompt) return true;
  if ((Object.values(INPAINT_PROJECTION_PROMPTS) as readonly string[]).includes(currentPrompt)) return true;
  if (currentPrompt.startsWith(HALL_CARRIER_EDIT_MARKER)) return true;
  if (
    (currentPrompt.includes("Output raster contract: exactly") ||
      currentPrompt.includes("Exact pixel-grid contract: @plate_sketch is itself")) &&
    (currentPrompt.startsWith("Use @plate_sketch as the exact projection-source guide") ||
      currentPrompt.startsWith("Repair @plate_sketch as the exact projection-source carrier"))
  ) {
    return true;
  }
  if (
    currentPrompt.startsWith("Use @plate_sketch as an exact square domemaster guide.") &&
    currentPrompt.includes("Visual harness:") &&
    currentPrompt.includes("Treat colored guide fill inside the projection circle as missing pixels")
  ) {
    return true;
  }
  if (
    currentPrompt.startsWith("Use @plate_sketch as a square bottom-facing equidistant 180 fisheye repair guide.") &&
    currentPrompt.includes("Visual harness:") &&
    currentPrompt.includes("Treat colored guide fill inside the projection circle as missing pixels")
  ) {
    return true;
  }
  if (
    currentPrompt.startsWith(`Use @plate_sketch as a ${CAVE_HANDOFF_GUIDE.promptTerms.carrierName} for inpainting`) &&
    currentPrompt.includes("Visual harness:")
  ) {
    return true;
  }
  if (
    currentPrompt.startsWith("Repair @plate_sketch as a square projection-source map.") &&
    currentPrompt.includes("warped source texture for an immersive projection surface") &&
    currentPrompt.includes("Scaffold meaning:")
  ) {
    return true;
  }
  if (
    currentPrompt.startsWith("Use @PlateSketch as an exact square domemaster guide") ||
    currentPrompt.startsWith("Use @PlateSketch as a square bottom-facing")
  ) {
    return true;
  }
  return (
    (currentPrompt.startsWith("Use @PlateSketch") || currentPrompt.startsWith("Use @plate_sketch")) &&
    OBSOLETE_GENERATED_INPAINT_PROMPT_MARKERS.some((marker) => currentPrompt.includes(marker))
  );
}

function zenith180InpaintPrompt(
  domeGuideSemanticSplit?: number | string | null,
  geometry = normalizePromptGeometry("zenith-180"),
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  return `Use @plate_sketch as the exact projection-source guide. It is an equidistant 180 fulldome map with the zenith at the center and the horizon at the outer circle. ${projectionAuthoringClause(geometry, "zenith-180")} ${plateTreatmentClause(geometry, "zenith-180", plateIntegrationMode, domeGuideSemanticSplit)} Preserve the authored plate subjects, placement, orientation, scale envelope, and fisheye geometry while integrating them into one image. ${domeGuidePromptClause("zenith-180", domeGuideSemanticSplit)} ${INPAINT_GUIDE_PROMPT} Complete missing regions as a coherent continuation of the source-derived visual world and medium. No visible cyan/blue guide patches, green patches, mask edges, checkerboards, dividers, radial spokes, central holes, pasted crop boundaries, or repair boundaries. Output one clean opaque domemaster at the exact raster contract.`;
}

function zenith230InpaintPrompt(
  domeGuideSemanticSplit?: number | string | null,
  domeGuideHorizonSplit?: number | string | null,
  geometry = normalizePromptGeometry("zenith-230"),
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  return `Use @plate_sketch as the exact projection-source guide. It is an equidistant 230 fulldome map with the zenith at the center, the physical horizon direction remapped to the editable source-map horizon carrier, and the outer circle extending 25 degrees below the horizon. ${projectionAuthoringClause(geometry, "zenith-230")} ${plateTreatmentClause(geometry, "zenith-230", plateIntegrationMode, domeGuideSemanticSplit, domeGuideHorizonSplit)} Preserve the authored plate subjects, placement, orientation, scale envelope, and fisheye geometry while integrating them into one image. ${domeGuidePromptClause("zenith-230", domeGuideSemanticSplit, domeGuideHorizonSplit)} ${INPAINT_GUIDE_PROMPT} Complete missing regions as a coherent continuation of the source-derived visual world across the horizon transition. No visible cyan/blue guide patches, green patches, mask edges, checkerboards, dividers, radial spokes, central holes, pasted crop boundaries, or repair boundaries. Output one clean opaque zenith 230 domemaster at the exact raster contract.`;
}

function nadir180InpaintPrompt(
  domeGuideSemanticSplit?: number | string | null,
  geometry = normalizePromptGeometry("nadir-180"),
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  return `Use @plate_sketch as the exact projection-source guide for a bottom-facing equidistant 180 fisheye repair. ${projectionAuthoringClause(geometry, "nadir-180")} ${plateTreatmentClause(geometry, "nadir-180", plateIntegrationMode, domeGuideSemanticSplit)} ${NADIR_INPAINT_GUIDE_PROMPT} ${domeGuidePromptClause("nadir-180", domeGuideSemanticSplit)} Preserve the authored plate subjects, placement, orientation, scale envelope, and fisheye geometry while integrating them into one image. Complete missing regions as one coherent lower-facing continuation of the source-derived visual world. Sky-like material is allowed only near the horizon rim if the existing plates unmistakably show it there. No visible cyan/blue guide patches, green patches, mask edges, checkerboards, dividers, radial spokes, central holes, pasted crop boundaries, sky-filled center, or repair boundaries. Output one clean opaque nadir fisheye at the exact raster contract.`;
}

function cave270InpaintPrompt(
  domeGuideSemanticSplit?: number | string | null,
  domeGuideHorizonSplit?: number | string | null,
  geometry = normalizePromptGeometry("cave-270"),
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  const splitPercent = Math.round(normalizeSourceInnerGuideSplit(domeGuideSemanticSplit, "cave-270") * 100);
  const horizonPercent = Math.round(caveGuideHorizonBand(domeGuideSemanticSplit, domeGuideHorizonSplit) * 100);
  return `Repair @plate_sketch as the exact projection-source carrier map. This is a warped source texture for an immersive projection surface, not a camera image. ${projectionAuthoringClause(geometry, "cave-270")}

${plateTreatmentClause(geometry, "cave-270", plateIntegrationMode, domeGuideSemanticSplit, domeGuideHorizonSplit)}

Geometric meaning of the map:
- the center region represents floor-source content directly under the viewer and currently occupies ${splitPercent}% of the source-map radius
- moving outward from the center means moving from floor surface into vertical perimeter surfaces
- the wall carrier has an eye-level/horizon breakpoint at ${horizonPercent}% of the source-map radius
- the outer raster boundary represents the upper edge of the perimeter surface
- angular direction around the center corresponds to direction around the room perimeter
- the image is intentionally warped as a source map

Field meaning:
- the continuous green-to-cyan-to-blue color field is missing image data, not scene lighting or an object
- its first authored color stop is the exact floor-to-wall allocation anchor
- its second authored color stop is the eye-level allocation anchor
- its periodic hue tint encodes direction continuously without drawing radial construction lines
${caveGuidePromptClause(domeGuideSemanticSplit, domeGuideHorizonSplit)}

Keep the recognizable content, local placement, distortion direction, scale envelope, botanical forms, luminous graphics, and other principal landmarks of every authored plate. Harmonize color, texture, atmosphere, reflections, lighting, crop shape, and boundary treatment where needed to make the carrier continuous. Never relocate or repurpose a plate to make it cover a different semantic zone.

Replace the complete positional field according to the semantic-zone partition and anchored integration procedure above. The floor should transition naturally into the perimeter surfaces, and the floor-to-wall transition must become invisible finished image content. A plate touching one zone may seed generated texture in that zone and may be repainted across its boundary, but its principal content stays in its authored spatial envelope.

Do not output a room render, perspective view, cube map, hallway, panels, visible wall corners, visible floor edge, panorama, fisheye circle, dome bubble, or normal photograph.

Before output, verify: no green, no cyan/blue, no black guide lines, no visible floor-wall seam, no wall-corner outlines, no pasted plate edges, no generic fog.

Output one clean opaque warped projection-source texture at the exact raster contract only.`;
}

function doubleGableHallInpaintPrompt(
  roofSplit?: number | string | null,
  horizonSplit?: number | string | null,
  geometry = normalizePromptGeometry("hall-double-gable"),
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  const roof = normalizeSourceInnerGuideSplit(roofSplit, "hall-double-gable");
  const horizon = normalizeSourceGuideCarrierHorizonRadius("hall-double-gable", roof, horizonSplit);
  const roofProfile = geometry.surface.kind === "double-gable-room" ? planarRoofProfile(geometry.surface) : [];
  const planeCount = Math.max(1, roofProfile.length - 1);
  return `${HALL_CARRIER_EDIT_MARKER} — SURGICAL 2D TEXTURE INPAINT

TASK
Edit @plate_sketch in place as one continuous profiled-hall carrier. Replace the continuous cyan, blue, aqua, and green positional field with locally coherent continuation of the authored content, and integrate each plate according to the selected preservation contract below.

${plateTreatmentClause(geometry, "hall-double-gable", plateIntegrationMode, roofSplit, horizonSplit)}

NON-NEGOTIABLE COMPOSITION ANCHORS
- @plate_sketch is already the authored 2D projection-carrier layout. It is not permission to invent a new view, reframe the room, or move subjects toward a center, corner, wall, roof, or vanishing point.
- Preserve each plate's recognizable subject, principal landmarks, authored spatial envelope, rotation direction, scale relationship, warp direction, and semantic role.
- The original crop silhouette is not sacred. Repaint inward and outward across it, relight and color-harmonize it, and reshape or dissolve its boundary wherever necessary to eliminate a pasted rectangular or quadrilateral patch.
- Do not mirror, duplicate, symmetrize, kaleidoscope, delete, or radically reinterpret existing content.

OUTPUT MODE
Return one opaque full-frame 2D source-texture atlas at the exact raster contract. The flat result is intentionally warped and abstract. It must not look like a plausible camera view, architectural visualization, or view from inside a room. There is no camera framing and no perspective composition in this 2D output.

FORBIDDEN FAILURE MODES
- no central vanishing point, central back wall, rectangular opening, atrium, tunnel, corridor, box interior, four-sided room, or ceiling seen from below
- no bilateral, radial, fourfold, mirrored, repeated, or kaleidoscopic composition
- no invented floor, floor plane, ground plane, room corners, columns, beams, panels, frames, grid, or architectural outlines
- no fisheye circle, cubemap, panorama, separated surface atlas, black panel gaps, or visible projection seams

2D CARRIER INVARIANTS
- Let square radius be rho = max(abs(2x - 1), abs(2y - 1)). Each output coordinate (x,y) must retain the same carrier sample as the input.
- rho 0 to ${formatPromptPercent(roof)}% is the continuous ${planeCount}-plane roof allocation. The center is merely one roof-source coordinate, never a distant wall or opening.
- rho ${formatPromptPercent(roof)}% is the roof-to-wall allocation anchor. It is a coordinate transition, not a line or visible architectural edge.
- rho ${formatPromptPercent(roof)}% to 100% is the four-wall perimeter allocation, continuous through its corner trajectories.
- rho ${formatPromptPercent(horizon)}% is the eye-level allocation anchor. The outer raster edge is the open bottom of the walls; this carrier contains no floor pixels.
- The roof profile varies only across hall width and is extruded unchanged along hall length. Ridges, valleys, and planar breaks therefore run parallel to the long axis; they do not radiate from the center.

POSITIONAL FIELD
- The blue-to-aqua bands inside the roof allocation encode the cross-hall roof-height function H(z). They are missing pixels, not sky, empty space, lighting, beams, stripes, a recessed center, or perspective depth.
- The green/cyan outer field is missing wall texture. Its hue variation encodes continuous perimeter position, not illumination or atmosphere.
- The colored field boundaries are fill fronts, not objects. Remove every trace of cyan, blue, aqua, and green guide color from the final image.

FILL METHOD
- Grow texture locally outward from every adjacent artwork boundary into the colored field, preserving the boundary's existing texture scale, direction, warp, lighting, and detail frequency.
- Where fill fronts meet, merge them as one uninterrupted artwork field without a seam. Do not reorganize the whole image to make a recognizable room.
- Continue across the roof allocation, roof-to-wall anchor, roof profile changes, wall corners, and horizon allocation without drawing any of those boundaries.

PRESERVE CHECK
Before output, compare against @plate_sketch: every plate's principal subject and landmarks must remain recognizable in the same local carrier neighborhood, with the same compositional role and relative scale. Its original crop boundary should no longer be detectable. Reject the result if content has been relocated into a new composition or if it forms a room view, centered opening, vanishing point, mirrored symmetry, or four-sided tunnel.

GEOMETRY METADATA
${projectionAuthoringClause(geometry, "hall-double-gable")}

Output exactly one clean opaque full-frame profiled-hall source carrier. No explanatory text and no alternate view.`;
}

function cylinderInpaintPrompt(
  mode: Extract<SourceProjectionMode, "cylinder-nadir" | "cylinder-zenith">,
  guideSplit?: number | string | null,
  horizonSplit?: number | string | null,
  geometry = normalizePromptGeometry(mode),
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  const isNadir = mode === "cylinder-nadir";
  const cap = isNadir ? "floor" : "ceiling";
  const nearWall = isNadir ? "lower" : "upper";
  const farWall = isNadir ? "upper" : "lower";
  const rim = isNadir ? "top edge" : "bottom edge";
  const split = normalizeSourceInnerGuideSplit(guideSplit, mode);
  const horizon = Math.max(split, Math.min(Number(horizonSplit) || split + (1 - split) * 0.5, 0.94));
  const splitPercent = formatPromptPercent(split);
  const horizonPercent = formatPromptPercent(horizon);
  return `Repair @plate_sketch as the exact projection-source carrier: one cylinder continuity-source map using the prescribed full-frame raster. This is a warped source texture for a continuous 360-degree cylindrical projection surface, not a camera photograph, panorama, dome render, or visible cylinder illustration. ${projectionAuthoringClause(geometry, mode)}

${plateTreatmentClause(geometry, mode, plateIntegrationMode, guideSplit, horizonSplit)}

Geometric meaning of the map:
- the center point is the ${cap} center on the cylinder axis
- the tiny inner disk from the center to ${splitPercent}% of source radius is the complete ${cap} cap, compressed intentionally to keep the map continuous and invertible
- the seam at ${splitPercent}% is the ${cap}-to-wall boundary
- moving outward through the annulus means moving ${nearWall}-to-${farWall} along the vertical cylinder wall
- the eye-level horizon is at ${horizonPercent}% of source radius
- the outer circular rim is the cylinder wall ${rim}
- angle around the image center is continuous 360-degree azimuth around the cylinder
- the exterior outside the source circle is protected and must remain pure black

Preserve every plate's recognizable content, warped spatial neighborhood, scale relationship, orientation, and semantic role. Repaint, relight, locally warp, extend, or partially occlude plate material where necessary to integrate it with coherent continuation across the ${cap}-wall seam and around the 360-degree wrap. Remove every field trace, original crop boundary, pasted edge, and visible seam.

Do not expand the tiny ${cap} cap, turn the map into a conventional fisheye, create a rectangular panorama, introduce a central hole, draw a cylinder, add room corners, or reframe the composition as a perspective scene.

Output one clean opaque image at the exact raster contract, preserving the prescribed cylinder carrier domain with pure black exterior only.`;
}

function cylinderWallInpaintPrompt(
  guideSplit?: number | string | null,
  geometry = normalizePromptGeometry("cylinder-wall"),
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  const horizon = normalizeSourceInnerGuideSplit(guideSplit, "cylinder-wall");
  return `Repair @plate_sketch as the exact projection-source carrier: one 21:9 equirectangular 360-degree cylinder-wall texture. Imagine the inside wall of a cylinder cut once along its back vertical seam and unrolled flat. This is not a perspective photograph, a centered landscape composition, or an illustration of a cylinder. ${projectionAuthoringClause(geometry, "cylinder-wall")}

${plateTreatmentClause(geometry, "cylinder-wall", plateIntegrationMode, guideSplit)}

Geometric meaning of the map:
- image X is continuous 360-degree azimuth around the cylinder
- the left and right raster edges meet at the same physical vertical seam; their boundary columns are consecutive periodic samples and must join continuously in color, structure, lighting, scale, direction, and texture phase
- x=0% and x=100% are the identified back seam; x=25% is one quarter-turn, x=50% is the opposite/front wall, and x=75% is the other quarter-turn
- every horizontal scanline is one closed ring around the cylinder; there is no privileged image center, hero framing, or central vanishing point
- image Y traverses the complete wall from ceiling at the top edge to floor at the bottom edge
- the eye-level horizon is allocated at ${formatPromptPercent(horizon)}% of the bottom-to-top carrier traversal
- there is no floor or ceiling cap in this carrier; do not invent one
- every pixel belongs to the cylindrical wall, so there is no circular mask or black exterior

Follow the EDIT / PRESERVE priorities above exactly. Outside the protected periodic seam corridor, repaint inward and outward across old crop boundaries enough to make each plate native to the continuous wall texture. Replace every remaining guide-field pixel and remove every guide line, registration mark, pasted edge, bounding-box patch, and scaffold trace. Inside the protected corridor, preserve authored detail and synthesize only the guide field as directed.

Do not convert the chart into a single-view room photograph, centered garden scene, perspective landscape, fisheye, domemaster, radial cylinder carrier, visible cylinder, or image with black margins. A flat 360-degree equirectangular wall panorama is the required output topology.

Output one clean opaque full-frame 21:9 wall carrier at the exact raster contract.`;
}

function normalizePromptGeometry(
  mode: SourceProjectionMode,
  geometry?: InpaintProjectionPromptGeometry,
): InpaintProjectionPromptGeometry {
  return {
    raster: geometry?.raster || carrierRasterForProjection(mode, carrierRasterForAspect("1:1")),
    surface: normalizeProjectionSurfaceForMode(geometry?.surface || defaultProjectionSurface(mode), mode),
    ...(geometry?.frame ? { frame: geometry.frame } : {}),
  };
}

function plateTreatmentClause(
  geometry: InpaintProjectionPromptGeometry,
  mode: SourceProjectionMode,
  plateIntegrationMode: PlateIntegrationMode,
  guideSplit?: number | string | null,
  horizonSplit?: number | string | null,
): string {
  if (plateIntegrationMode === "strict") {
    return plateStrictPixelLockClause(geometry, mode, guideSplit, horizonSplit);
  }
  if (mode === "cylinder-wall") {
    return cylinderWallIntegratedPreservationClause(geometry, guideSplit, horizonSplit);
  }
  return plateIntegratedPreservationClause(geometry, mode, guideSplit, horizonSplit);
}

function cylinderWallIntegratedPreservationClause(
  { raster, frame }: InpaintProjectionPromptGeometry,
  guideSplit?: number | string | null,
  horizonSplit?: number | string | null,
): string {
  const mode: SourceProjectionMode = "cylinder-wall";
  const layers = (frame?.plateLayers || [])
    .filter((layer) => layer.visible !== false && layer.placement.opacity > 0)
    .sort((a, b) => a.index - b.index);
  const ledger = layers.length
    ? `\nAZIMUTH-LOCKED PLATE LEDGER — ${layers.length} visible authored layer${layers.length === 1 ? "" : "s"}\n${layers
        .map((layer, index) => plateLayerLedgerLine(layer, index, mode, raster, guideSplit, horizonSplit, "integrated"))
        .join("\n")}`
    : "";
  const seamLedger = cylinderWallSeamCrossingLedger(layers, raster);
  const sourceReferences = sourceAppearanceReferenceClause(frame);

  return `ZENITH CYLINDER-WALL EDIT CONTRACT v3

EDIT IMAGE 1 / @plate_sketch IN PLACE
- This is an image-edit task on an already registered ${raster.width}×${raster.height} equirectangular wall chart, not a request to compose a new scene. Input coordinate (x,y) and output coordinate (x,y) are the same cylindrical carrier address.
- Before generating, classify the input into two kinds of pixels: (A) detailed authored plate content and (B) the smooth cyan/blue/green positional guide field. Plate content is evidence to preserve and integrate. Only the positional guide field is missing imagery to replace.

${sourceReferences}

PRESERVE — THESE ARE INVARIANTS
- Preserve the chart topology, plate count, relative azimuth order, recognizable subjects, principal landmarks, approximate x/azimuth and y/height positions, orientation, relative scale, and layer identity.
- Do not crop, resize, pan, roll, rotate, mirror, pad, reframe, or move subjects toward the center. Do not turn this unusual flat texture chart into a conventional photograph.
- Existing crop silhouettes and literal pixels away from the periodic cut may be repainted enough to remove pasted boundaries. The authored subject placement and relationships remain authoritative.${ledger}

PROTECTED PERIODIC SEAM CORRIDOR — HIGHEST PRIORITY
- The last raster column x=${raster.width - 1} and first raster column x=0 are consecutive neighboring samples around one closed ring. They are one pixel step apart, not duplicate samples and not unrelated image margins.
- The seam-crossing layer facts below are derived from Zenith's authored plate-placement metadata. They are mandatory facts, not visual suggestions and not something to infer again from the image.${seamLedger}
- Treat the last 10% of the right edge and first 10% of the left edge together in the order [right strip | left strip] as one local neighborhood. Never process, redesign, or complete either strip independently.
- Within those two strips, detailed authored plate pixels are high-fidelity seam evidence. Preserve their row alignment, recognizable cross-edge structure, scale, orientation, direction, exposure, illumination, depth layer, texture phase, and relative offset. If a plate appears on both edges, it is one wrap-crossing plate, not two plates.
- Within those two strips, only smooth positional-guide pixels may be freely replaced. Fill those guide pixels by extending immediately adjacent authored material locally across the old plate boundary and across the identified wrap. Do not replace the protected edge evidence with newly staged plants, trunks, leaves, flowers, interface panels, cloud bands, horizons, or other large landmarks.
- Do not place a unique object against only one edge. Anything that reaches x=${raster.width - 1} must continue naturally from x=0 at the same y, scale, direction, thickness, lighting, and depth. The edge transition must look like an ordinary transition between neighboring columns.

CHANGE — ONLY WHAT IS NEEDED
- Replace every remaining smooth positional-guide pixel with coherent wall imagery derived from the nearest authored content and the intended semantic height zone.
- Away from the protected seam corridor, repaint inward and outward through every old crop edge until no rectangle, curved strip, pasted island, exposure patch, or texture-frequency discontinuity remains.
- Harmonize color, atmosphere, material, and local organic structure while keeping each source recognizable and near its authored cylindrical address. Do not delete, duplicate, mirror, kaleidoscope, merge away, or expand one source around the whole circumference.
- Priority order: preserve the periodic seam evidence first; preserve cylindrical addresses and plate identity second; replace the guide field third; dissolve old crop boundaries fourth; conventional photographic beauty last.

${semanticSegmentationClause(mode, guideSplit, horizonSplit, "integrated")}

FINAL VERIFICATION
1. Tile three identical, unscaled copies horizontally and inspect both joins at 100% scale.
2. Compare transition x=${raster.width - 1}→0 with ordinary local transitions x=${raster.width - 2}→${raster.width - 1} and x=0→1. The wrap must be no more abrupt unless one real continuous high-contrast structure crosses all three samples.
3. Reject and revise any result with a vertical seam, unrelated left/right margins, a one-sided edge subject, repeated edge object, lighting jump, scale jump, texture-phase jump, or broken structure.
4. Confirm every source remains recognizable near its authored azimuth and height and no old crop silhouette survives.

Return only the finished 21:9 equirectangular wall texture. Do not output a perspective preview, cylinder render, masks, labels, coordinates, or intermediate passes.`;
}

function cylinderWallSeamCrossingLedger(layers: DomeSceneFrame0["plateLayers"], raster: CarrierRaster): string {
  const crossings = layers.flatMap((layer, index) => {
    const center = sourceMapPointToUv(layer.placement, "cylinder-wall", raster.width, raster.height);
    const sourceAspect = Math.max(Number(layer.source.aspect) || 1, 0.000001);
    const scale = Math.max(Number(layer.placement.scale) || 0, 0.000001);
    const angularWidth = 2 * Math.atan(scale * 0.5);
    const angularHeight = 2 * Math.atan((scale / sourceAspect) * 0.5);
    const spin = ((Number(layer.placement.spin) || 0) * Math.PI) / 180;
    const warpExpansion = Math.max(
      1,
      ...Object.values(layer.placement.cornerOffsets).map((offset) => 1 + Math.abs(offset.x) * 2 + Math.abs(offset.y)),
    );
    const projectedAngularWidth =
      (Math.abs(Math.cos(spin)) * angularWidth + Math.abs(Math.sin(spin)) * angularHeight) * warpExpansion;
    const halfSpan = Math.min(0.49, projectedAngularWidth / (Math.PI * 2) / 2);
    const crosses = center.u - halfSpan <= 0 || center.u + halfSpan >= 1;
    if (!crosses) return [];
    const side = center.u < 0.5 ? "left-edge-centered" : "right-edge-centered";
    return [
      `- CONFIRMED: Layer ${index + 1} crosses the periodic cut; its visible left-edge and right-edge fragments are clipped portions of this one ${side} authored layer. Preserve their shared source identity and join them to each other. Do not complete either fragment as a separate plant, object, or scene margin.`,
    ];
  });

  if (crossings.length > 0) {
    return `\nCONFIRMED SEAM-CROSSING LAYERS\n${crossings.join("\n")}`;
  }
  return `\nCONFIRMED SEAM-CROSSING LAYERS\n- No authored plate crosses the periodic cut. Keep the join low-salience and continue only shared background, atmosphere, illumination, and fine texture across it. Do not invent a trunk, large plant, flower, interface panel, horizon landmark, or other unique subject at either edge.`;
}

function plateIntegratedPreservationClause(
  { raster, frame }: InpaintProjectionPromptGeometry,
  mode: SourceProjectionMode,
  guideSplit?: number | string | null,
  horizonSplit?: number | string | null,
): string {
  const layers = (frame?.plateLayers || [])
    .filter((layer) => layer.visible !== false && layer.placement.opacity > 0)
    .sort((a, b) => a.index - b.index);
  const ledger = layers.length
    ? `\nANCHORED PLATE LEDGER — ${layers.length} visible authored layer${layers.length === 1 ? "" : "s"}\n${layers
        .map((layer, index) => plateLayerLedgerLine(layer, index, mode, raster, guideSplit, horizonSplit, "integrated"))
        .join("\n")}`
    : "";
  const sourceReferences = sourceAppearanceReferenceClause(frame);

  return `${INTEGRATED_PLATE_EDIT_MARKER}
- Image 1 / @plate_sketch is the sole authority for projection topology, layer count, plate placement, warp, scale, orientation, and authored spatial relationships. It is not a loose moodboard and not permission to compose a different image layout.
${sourceReferences}
- The complete output raster remains registered to the input: keep the carrier center, rim, azimuth, semantic zones, and black exterior fixed. Do not crop, pan, reframe, mirror, or convert the carrier into a conventional camera view.
- Treat each visible plate as an ANCHORED REGION OF INTENT, not a protected bitmap cutout. Preserve its recognizable subject, principal internal landmarks, approximate center, orientation, relative scale, warp direction, and compositional role.
- The original plate silhouette, alpha edge, rectangle, quadrilateral, crop boundary, exposure, color grade, and literal pixels are not sacred. They may be repainted, relit, recolored, locally warped, extended, partially occluded, or regenerated when that makes the complete projection image coherent.
- BOUNDARY PERMEABILITY: synthesize through both sides of every old plate boundary. Harmonize inward into the source plate as well as outward into the missing positional field. No evidence of a pasted island, bounding box, hard crop, mismatched exposure, or abrupt texture-frequency change may remain.
- PLACEMENT TOLERANCE: keep each principal subject in its authored carrier neighborhood. As a default bound, keep its main landmark within about 5% of the output width/height from the authored position, its apparent scale within about 15%, and its orientation within about 10 degrees. Local organic deformation and boundary growth are allowed; relocation into a different semantic zone is not.
- Preserve layer order and the identity of distinct plates. Do not delete, duplicate, merge away, mirror, kaleidoscope, or let one plate expand across the carrier merely because its subject is easy to continue.
- Priority order: carrier topology and authored plate placement first; source-reference appearance and content identity second; seamless boundary assimilation and whole-image harmony third; literal source pixels and crop silhouettes last.${ledger}

${semanticSegmentationClause(mode, guideSplit, horizonSplit, "integrated")}

ANCHORED INTEGRATION EXECUTION — FOLLOW IN THIS ORDER
1. REGISTER: align @plate_sketch to the requested output raster with identical carrier center, rim, corners, and azimuth. The carrier coordinate system must not move.
2. INVENTORY: identify every visible plate, its principal subject and stable landmarks, approximate authored center, orientation, scale, warp direction, layer order, and semantic-zone coverage. These are the anchors to preserve—not the old rectangular crop.
3. CLASSIFY: distinguish authored plate regions from the smooth analytical positional field, including plate areas whose colors resemble the guide. Decode every field pixel into the semantic carrier zones listed above before generating.
4. ESTABLISH THE CONTINUOUS VISUAL WORLD: infer one shared medium, material family, lighting logic, atmosphere, depth behavior, and projection-aware texture flow from all plates and their matching source references. Preserve the kind of imagery actually supplied: macro, abstract, translucent, liquid, graphic, photographic, or representational. Do not translate ambiguous material into a conventional landscape, room, or object scene merely to make it easier to name.
5. INTEGRATE INWARD AND OUTWARD: generate the missing field while also allowing a transition band inside each plate. Repaint and harmonize plate material as needed so texture scale, structure, lighting, color, atmosphere, and projection warp pass continuously across the former crop boundary.
6. DISSOLVE OLD SILHOUETTES: extend forms across boundaries, introduce natural overlap or occlusion, and reshape the old crop edge wherever helpful. Do not preserve a rectangular or quadrilateral island merely because it existed in the input.
7. RECONCILE FILL FRONTS: where continuations meet, resolve them as one uninterrupted visual field while keeping each plate's principal content recognizable and locally anchored.
8. VERIFY: compare against @plate_sketch. The same subjects and important landmarks must remain in the same carrier neighborhoods and relative arrangement, but no old bounding box, pasted edge, tonal patch, or texture discontinuity should be detectable.

Do not output masks, labels, coordinates, guide colors, or intermediate passes. Return only the finished carrier image.`;
}

function sourceAppearanceReferenceClause(frame: DomeSceneFrame0 | undefined): string {
  const references = inpaintSourceReferenceDescriptors(frame);
  if (references.length === 0) {
    return `SOURCE APPEARANCE AUTHORITY
- No separate original-source references are attached. Derive appearance conservatively from the authored plate pixels in @plate_sketch; do not replace ambiguous imagery with a more conventional subject.`;
  }

  return `SOURCE APPEARANCE REFERENCES — CONTENT AUTHORITY, NEVER POSITION AUTHORITY
${references
  .map(
    (reference) =>
      `- Image ${reference.referenceOrdinal} / @${reference.tag} is the original unwarped appearance reference for Layer ${reference.layerOrdinal} (${reference.sourceName}, ${reference.width}×${reference.height}). Use it to recover that layer's content identity, material, microstructure, translucency, color relationships, lighting character, detail frequency, and visual medium. Its matching plate footprint in @plate_sketch alone determines where, how large, and with what warp that content belongs.`,
  )
  .join("\n")}
- Read all source references together before deciding what kind of visual world they depict. Preserve their shared aesthetic and degree of abstraction. If they are macro, abstract, liquid, translucent, microscopic, textural, or nonrepresentational, the completed carrier must remain so.
- The source references are not extra plates, alternate compositions, backgrounds, or permission to restage a conventional photograph. Do not copy their original square framing into the output and do not place them anywhere except the authored neighborhoods shown in @plate_sketch.
- Never reinterpret ambiguous green, blue, reflective, organic, or glass-like matter as a forest, garden, sky, terrain, waterway, architecture, or other named scene unless that subject is unmistakably present across the source references themselves.`;
}

function plateStrictPixelLockClause(
  { raster, frame }: InpaintProjectionPromptGeometry,
  mode: SourceProjectionMode,
  guideSplit?: number | string | null,
  horizonSplit?: number | string | null,
): string {
  const layers = (frame?.plateLayers || [])
    .filter((layer) => layer.visible !== false && layer.placement.opacity > 0)
    .sort((a, b) => a.index - b.index);
  const ledger = layers.length
    ? `\nLOCKED ARTWORK LEDGER — ${layers.length} visible authored layer${layers.length === 1 ? "" : "s"}\n${layers
        .map((layer, index) => plateLayerLedgerLine(layer, index, mode, raster, guideSplit, horizonSplit, "strict"))
        .join("\n")}`
    : "";

  return `${PIXEL_LOCK_EDIT_MARKER}
- Image 1 / @plate_sketch is both the source image and the absolute 2D coordinate authority. Edit it in place; do not use it as a loose moodboard or as permission to compose a new view.
- Raster coordinates are immutable: input pixel (x,y) corresponds to output pixel (x,y), with top-left (0,0) and bottom-right (${raster.width - 1},${raster.height - 1}). Do not crop, pan, zoom, reframe, rotate, mirror, translate, scale, duplicate, or reproject existing artwork.
- LOCKED PIXELS are the complete visible footprint of every photographic, illustrated, luminous, botanical, graphic, or otherwise authored plate island already present in @plate_sketch. Once a plate silhouette is identified, lock its entire enclosed interior—including smooth sky, fog, water, shadows, transparency, low-detail areas, and feathered edge pixels—not only its high-frequency details. Preserve those pixels and exact visible silhouettes even when their colors are cyan, blue, aqua, green, or similar to the guide.
- EDITABLE PIXELS are only the smooth, featureless, low-frequency positional-field regions between and around the authored artwork. Color alone never makes a pixel editable. A detailed green or cyan artwork pixel remains locked.
- COPY-THROUGH RULE: treat locked pixels as already-finished output pixels, not as conditioning material to regenerate. At every locked coordinate, copy the input color and detail directly to the same output coordinate. Zero optical flow, zero displacement, zero resampling, and zero diffusion are allowed inside the locked mask.
- Synthesize behind and between the locked artwork islands. Extend locally from each island's existing boundary; never absorb, redraw, restage, or move an island to make the scene more plausible.
- Projection and venue metadata explain how newly filled pixels will be projected. They are never instructions to rearrange the locked 2D composition into walls, roof panels, a room view, or a perspective image.
- Priority order: exact artwork pixel conservation first; frozen semantic segmentation second; exact raster and carrier topology third; seamless local continuation fourth; semantic or architectural plausibility last.${ledger}

${semanticSegmentationClause(mode, guideSplit, horizonSplit, "strict")}

MASKED EDIT EXECUTION — FOLLOW IN THIS ORDER
1. REGISTER: align @plate_sketch to the requested output raster with identical corners and no transform.
2. SEGMENT PLATE ISLANDS: detect every complete connected plate silhouette using its boundary discontinuity, internal photographic structure, feathered edge, and the layer ledger. Flood-fill each silhouette's full interior so smooth or guide-colored pixels inside a plate remain included. The ARTWORK_MASK is the union of those complete plate footprints. GUIDE_MASK is only the remaining globally continuous analytical positional field outside them. Do this before generating anything. Never revise these masks to improve scene plausibility, and never cut holes in ARTWORK_MASK because an internal patch is smooth or blue/green.
3. COPY: place an exact unchanged copy of ARTWORK_MASK pixels into the output. Treat this copied layer as protected and unavailable to the generative pass.
4. CLASSIFY: divide GUIDE_MASK pixels into the semantic carrier zones listed above using their source coordinates and authored anchors. The smooth gradient is a coordinate field, not an invitation to average the zone meanings.
5. ASSIGN BOUNDARY OWNERSHIP: each connected artwork island owns its existing silhouette boundary. For a missing pixel, draw appearance evidence from the nearest compatible boundary in the same semantic zone and local carrier direction. Do not expand one plate across the entire canvas or recruit a distant plate merely because its subject is recognizable.
6. INPAINT BEHIND: synthesize only GUIDE_MASK pixels. Grow new texture outward from owned boundaries while preserving local scale, orientation, projection warp, lighting, and detail frequency. If no plate touches a zone, invent only the missing background for that zone; never move a plate there.
7. MERGE GENERATED FRONTS: blend only newly generated pixels where fill fronts meet. Do not blend, feather, repaint, or color-grade the protected artwork layer.
8. COMPOSITE: place the unchanged copied artwork layer back over the generated fill at its original coordinates. The only permitted transition is sub-pixel blending on the editable side of the original silhouette edge.
9. VERIFY: compare input and output as a same-size difference image. Every ARTWORK_MASK pixel must have zero displacement and visually identical internal landmarks. If not, discard the draft and repeat from the frozen masks.

Do not output the masks, labels, coordinates, guide colors, or intermediate passes. Return only the finished carrier image.

PIXEL-LOCK VALIDATION
Before returning the image, compare it directly with @plate_sketch as a same-size overlay. Every locked artwork boundary, internal landmark, crop, rotation, scale, warp, and layer count must coincide. If any authored island moved, grew, shrank, merged, duplicated, disappeared, or changed silhouette, reject that draft and restore the input pixels.`;
}

function plateLayerLedgerLine(
  layer: DomeSceneFrame0["plateLayers"][number],
  ordinal: number,
  mode: SourceProjectionMode,
  raster: CarrierRaster,
  guideSplit?: number | string | null,
  horizonSplit?: number | string | null,
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  const center = sourceMapPointToUv(layer.placement, mode, raster.width, raster.height);
  const zone = sourceGuideZones(mode, guideSplit, horizonSplit).find(
    (candidate) =>
      layer.placement.radius >= candidate.startRadius - 0.000001 &&
      layer.placement.radius <= candidate.endRadius + 0.000001,
  );
  const warpedCorners = Object.values(layer.placement.cornerOffsets).filter(
    (offset) => Math.abs(offset.x) > 0.0001 || Math.abs(offset.y) > 0.0001,
  ).length;
  const treatment =
    plateIntegrationMode === "strict"
      ? "This metadata locates the already-visible locked footprint; the actual input silhouette and pixels remain authoritative and must not be approximated as a rectangle."
      : "This metadata anchors the subject and its spatial envelope; preserve the recognizable content and placement relationship while dissolving the old crop boundary into the continuous image.";
  return `- Layer ${ordinal + 1}: source ${layer.source.width}×${layer.source.height} (${formatAspect(layer.source.aspect)}); authored center x=${formatPromptPercent(center.u)}%, y=${formatPromptPercent(center.v)}%; carrier coordinate ${formatPromptPercent(layer.placement.radius)}%; center carrier band ${zone ? promptZoneRole(zone) : "unclassified carrier field"}; scale ${Number(layer.placement.scale.toFixed(4))}; rotation ${Number(layer.placement.spin.toFixed(2))} degrees; flip-X ${layer.placement.flipX ? "on" : "off"}; flip-Y ${layer.placement.flipY ? "on" : "off"}; ${warpedCorners} warped corner${warpedCorners === 1 ? "" : "s"}. ${treatment}`;
}

function semanticSegmentationClause(
  mode: SourceProjectionMode,
  guideSplit?: number | string | null,
  horizonSplit?: number | string | null,
  plateIntegrationMode: PlateIntegrationMode = DEFAULT_PLATE_INTEGRATION_MODE,
): string {
  const zones = sourceGuideZones(mode, guideSplit, horizonSplit);
  const plateRule =
    plateIntegrationMode === "strict"
      ? "Carrier bands govern only what may be synthesized behind the plates. They never authorize moving, scaling, rotating, cropping, or redrawing locked artwork. If an artwork island crosses a boundary, keep the whole island intact and let it provide local evidence to every band it actually touches."
      : "Carrier bands govern both field synthesis and boundary harmonization. They never authorize relocating a plate's principal subject into another band. If a plate crosses a boundary, preserve that authored crossing while adapting material on both sides so it belongs continuously to every band it actually touches.";
  return `FROZEN DIRECTIONAL CARRIER SEGMENTATION — DECODE BEFORE INPAINTING
Carrier coordinate: ${carrierCoordinatePrompt(mode)}
${zones.map((zone, index) => semanticZonePromptLine(zone, index)).join("\n")}
- The authored anchors are directional partition boundaries even though the displayed colors interpolate smoothly through them. Determine band membership from carrier coordinate, not from a vague visual impression of hue.
- These labels describe projection direction or physical carrier allocation only. They provide no subject, environment, or object vocabulary. The plates and their source references are the sole authority for appearance and subject.
- Preserve the complete spatial partition while generating: each editable pixel stays in its assigned carrier band. Continue the same authored visual world through that direction or surface without moving material to create a conventional scene hierarchy.
- ${plateRule}
- Preserve local azimuth and carrier direction. Continue content along the projection surface at the same scale instead of straightening the carrier into a conventional camera view.`;
}

function semanticZonePromptLine(zone: SourceGuideZone, index: number): string {
  return `- Band ${index + 1} / ${promptZoneId(zone)}: coordinate ${formatPromptPercent(zone.startRadius)}% to ${formatPromptPercent(zone.endRadius)}%; guide tone ${guideTonePrompt(zone.tone)}; allocation ${promptZoneRole(zone)}. Continue the source-derived visual medium through this carrier band. This label encodes geometry only and supplies no subject matter.`;
}

function promptZoneId(zone: SourceGuideZone): string {
  if (zone.id === "sky" || zone.id === "ceiling-cap") return "UPWARD_DIRECTION";
  if (zone.id === "horizon" || zone.id === "human-level") return "HUMAN_LEVEL_DIRECTION";
  if (zone.id === "below-horizon" || zone.id === "floor" || zone.id === "floor-cap") {
    return "DOWNWARD_DIRECTION";
  }
  if (zone.id === "roof") return "PROFILED_UPPER_SURFACE";
  if (zone.id === "lower-wall") return "LOWER_PERIMETER";
  if (zone.id === "upper-wall") return "UPPER_PERIMETER";
  return "AUTHORED_DIRECTION";
}

function promptZoneRole(zone: SourceGuideZone): string {
  if (zone.id === "sky" || zone.id === "ceiling-cap") return "upward-facing projection directions";
  if (zone.id === "horizon" || zone.id === "human-level") return "human-level projection directions";
  if (zone.id === "below-horizon" || zone.id === "floor" || zone.id === "floor-cap") {
    return "downward-facing projection directions";
  }
  if (zone.id === "roof") return "profiled upper-surface carrier directions";
  if (zone.id === "lower-wall") return "lower perimeter-surface carrier directions";
  if (zone.id === "upper-wall") return "upper perimeter-surface carrier directions";
  return "the authored projection directions for this band";
}

function carrierCoordinatePrompt(mode: SourceProjectionMode): string {
  if (mode === "cylinder-wall") {
    return "use the authored bottom-to-top wall traversal (0% at the bottom edge, 100% at the top edge); horizontal X remains continuous azimuth.";
  }
  if (mode === "cave-270" || mode === "hall-double-gable") {
    return "use square carrier radius rho=max(abs(2x-1), abs(2y-1)), where rho=0% is the raster center and rho=100% is the nearest outer edge; angular position around center is preserved.";
  }
  return "use radial carrier distance from the image center, 0% at center and 100% at the projection rim; angular position around center is preserved.";
}

function guideTonePrompt(tone: SourceGuideZone["tone"]): string {
  if (tone === "sky") return "cyan/blue overhead coordinate field";
  if (tone === "horizon") return "aqua/green human-level coordinate field";
  if (tone === "floor") return "green lower-world coordinate field";
  if (tone === "lower-wall") return "aqua lower-wall coordinate field";
  return "blue upper-wall coordinate field";
}

function formatAspect(value: number): string {
  return Number.isFinite(value) && value > 0 ? Number(value.toFixed(3)).toString() : "unknown aspect";
}

function projectionAuthoringClause(
  { raster, surface }: InpaintProjectionPromptGeometry,
  mode: SourceProjectionMode,
): string {
  return `Exact pixel-grid contract: @plate_sketch is itself ${raster.width} × ${raster.height} pixels, and the returned image must also be exactly ${raster.width} × ${raster.height} pixels (${raster.aspectPreset}, full-frame carrier). Keep one shared input/output coordinate frame: output (x,y) is the same carrier address as input (x,y), even when its content is repainted. Do not crop, resize, pad, change aspect ratio, or reframe. ${carrierRasterSamplingClause(raster, surface, mode)} ${projectionSurfacePromptClause(surface)}`;
}

function carrierRasterSamplingClause(
  raster: CarrierRaster,
  surface: ProjectionSurface,
  mode: SourceProjectionMode,
): string {
  const rectangular = Math.abs(raster.width / raster.height - 1) > 0.001;
  if (surface.kind === "cylinder") {
    if (mode === "cylinder-wall") {
      return "The complete rectangular raster is the unwrapped cylindrical wall: horizontal position is 360-degree azimuth, vertical position is wall height, and the left/right edges are an identified continuity seam.";
    }
    return rectangular
      ? "The normalized circular cylinder domain is intentionally sampled as a full-frame ellipse touching all four edge midpoints, with only the corner exterior black; do not replace it with a min-side pixel circle or a panorama."
      : "The normalized circular cylinder domain touches all four edge midpoints, with only the corner exterior black.";
  }
  if (surface.kind === "box-room") {
    return "The normalized square-perimeter room carrier spans the complete rectangular raster; its image aspect redistributes source sampling and is not a camera view or a change to room proportions.";
  }
  if (surface.kind === "double-gable-room") {
    return "The normalized observer-centred roof-and-wall carrier spans the complete rectangular raster; its image aspect redistributes samples over one continuous profiled roof shell and does not change the measured hall proportions.";
  }
  return rectangular
    ? "The angular fisheye remains a true pixel circle whose diameter is the raster's short edge, with protected black margins along the long axis; do not stretch it into an ellipse."
    : "The angular fisheye remains a true pixel circle touching the raster edge midpoints, with protected black corner exterior.";
}

function projectionSurfacePromptClause(surface: ProjectionSurface): string {
  if (surface.kind === "box-room") {
    return `Measured box-room geometry: width ${formatMeters(surface.width)}, depth ${formatMeters(surface.depth)}, height ${formatMeters(surface.height)}; physical horizon ${formatMeters(projectionSpatialAnchors(surface).horizonHeight)} above the venue floor, derived from observer eye height ${formatMeters(surface.eyeHeight)}${horizonCalibrationPromptClause(surface)}; observer pose X ${formatMeters(surface.eyeX)}, Z ${formatMeters(surface.eyeZ)}.`;
  }
  if (surface.kind === "cylinder") {
    return `Measured cylinder geometry: radius ${formatMeters(surface.radius)}, diameter ${formatMeters(surface.radius * 2)}, height ${formatMeters(surface.height)}; physical horizon ${formatMeters(projectionSpatialAnchors(surface).horizonHeight)} above the venue floor, derived from observer eye height ${formatMeters(surface.eyeHeight)}${horizonCalibrationPromptClause(surface)}.`;
  }
  if (surface.kind === "double-gable-room") {
    const anchors = planarRoofProfile(surface);
    const profile = anchors
      .map(
        (anchor) =>
          `${anchor.role} at ${formatPromptPercent(anchor.position)}% cross-hall / ${formatMeters(anchor.height)}`,
      )
      .join(", ");
    return `Measured planar-profile hall geometry: length ${formatMeters(surface.length)}, width ${formatMeters(surface.width)}; ordered roof anchors ${profile}; physical horizon ${formatMeters(projectionSpatialAnchors(surface).horizonHeight)} above the venue floor, derived from observer eye height ${formatMeters(surface.eyeHeight)}${horizonCalibrationPromptClause(surface)}; observer pose X ${formatMeters(surface.eyeX)}, Z ${formatMeters(surface.eyeZ)}; four walls and ${anchors.length - 1} exact roof planes, explicitly no floor.`;
  }
  const anchors = projectionSpatialAnchors(surface);
  return `Physical carrier: observer-centred angular projection surface; authored semantic elevation ${Number(anchors.semanticElevationDegrees.toFixed(2))} degrees; physical horizon ${Number(anchors.horizonElevationDegrees.toFixed(2))} degrees, derived from observer level at 0 degrees${horizonCalibrationPromptClause(surface)}.`;
}

function horizonCalibrationPromptClause(surface: ProjectionSurface): string {
  const offset = projectionSurfaceHorizonCalibrationOffset(surface);
  if (Math.abs(offset) <= 0.000_001) return " with no calibration offset";
  const unit = surface.kind === "angular" ? "degrees" : "m";
  return ` with an explicit ${formatSigned(offset)} ${unit} calibration offset`;
}

function formatMeters(value: number): string {
  return `${Number(value.toFixed(3))} m`;
}

function formatSigned(value: number): string {
  const rounded = Number(value.toFixed(3));
  return `${rounded > 0 ? "+" : ""}${rounded}`;
}

function formatPromptPercent(value: number): string {
  const percent = value * 100;
  return Number.isInteger(percent) ? String(percent) : percent.toFixed(1).replace(/\.0$/, "");
}
