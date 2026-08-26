import * as Schema from "effect/Schema";
import {
  CarrierRasterSchema,
  ProjectionSurfaceSchema,
  carrierRasterForAspect,
  cloneCarrierRaster,
  cloneProjectionSurface,
  defaultProjectionSurface,
  projectionSurfaceMatchesMode,
} from "./projection-authoring.js";
import { SOURCE_PROJECTION_MODES } from "./projection-profile.js";

export const DOME_SCENE_VERSION = 5;

export const DOME_SCENE_PROJECTION_MODES = SOURCE_PROJECTION_MODES;
export const DOME_SCENE_PLATE_FITS = ["contain", "cover", "stretch"] as const;

const finiteNumberSchema = Schema.Number.pipe(Schema.finite());
const nonEmptyStringSchema = Schema.String.pipe(Schema.minLength(1));

const DomeScenePlateCornerOffsetSchema = Schema.mutable(
  Schema.Struct({ x: finiteNumberSchema, y: finiteNumberSchema }),
);

const DomeScenePlateCornerOffsetsSchema = Schema.mutable(
  Schema.Struct({
    nw: DomeScenePlateCornerOffsetSchema,
    ne: DomeScenePlateCornerOffsetSchema,
    se: DomeScenePlateCornerOffsetSchema,
    sw: DomeScenePlateCornerOffsetSchema,
  }),
);

export const DomeScenePlatePlacementSchema = Schema.mutable(
  Schema.Struct({
    azimuth: finiteNumberSchema,
    radius: finiteNumberSchema,
    scale: finiteNumberSchema,
    spin: finiteNumberSchema,
    opacity: finiteNumberSchema,
    flipX: Schema.optionalWith(Schema.Boolean, { default: () => false }),
    flipY: Schema.optionalWith(Schema.Boolean, { default: () => false }),
    cornerOffsets: DomeScenePlateCornerOffsetsSchema,
  }),
);

export const DomeScenePlateSourceSchema = Schema.mutable(
  Schema.Struct({
    assetId: Schema.optional(nonEmptyStringSchema),
    name: nonEmptyStringSchema,
    width: finiteNumberSchema,
    height: finiteNumberSchema,
    aspect: finiteNumberSchema,
    url: Schema.optional(
      Schema.String.pipe(
        Schema.filter(
          (url) => !url.startsWith("blob:") || "object URLs are runtime-only and cannot be stored in Dome Scene",
        ),
      ),
    ),
    mime: Schema.optional(Schema.String),
  }),
);

export const DomeScenePlateLayerSchema = Schema.mutable(
  Schema.Struct({
    id: nonEmptyStringSchema,
    name: nonEmptyStringSchema,
    index: finiteNumberSchema,
    source: DomeScenePlateSourceSchema,
    placement: DomeScenePlatePlacementSchema,
    visible: Schema.optionalWith(Schema.Boolean, { default: () => true }),
    locked: Schema.optionalWith(Schema.Boolean, { default: () => false }),
  }),
);

export const DomeSceneFrame0Schema = Schema.mutable(
  Schema.Struct({
    plateFit: Schema.optionalWith(Schema.Literal(...DOME_SCENE_PLATE_FITS), { default: () => "contain" as const }),
    plateFeather: Schema.optionalWith(finiteNumberSchema, { default: () => 0.02 }),
    activeLayerId: Schema.optionalWith(Schema.NullOr(nonEmptyStringSchema), { default: () => null }),
    plateLayers: Schema.mutable(Schema.Array(DomeScenePlateLayerSchema)),
  }),
);

export const DomeSceneSchema = Schema.mutable(
  Schema.Struct({
    version: Schema.Literal(DOME_SCENE_VERSION),
    projectionMode: Schema.Literal(...DOME_SCENE_PROJECTION_MODES),
    surface: ProjectionSurfaceSchema,
    raster: CarrierRasterSchema,
    guideSplit: finiteNumberSchema,
    horizonSplit: finiteNumberSchema,
    frame0: DomeSceneFrame0Schema,
  }),
).pipe(
  Schema.filter((scene) => {
    if (!projectionSurfaceMatchesMode(scene.surface, scene.projectionMode)) {
      return {
        path: ["surface"],
        message: `surface kind ${scene.surface.kind} does not match projection mode ${scene.projectionMode}`,
      };
    }
    return true;
  }),
);

export type DomeSceneProjectionMode = (typeof DOME_SCENE_PROJECTION_MODES)[number];
export type DomeScenePlateFit = (typeof DOME_SCENE_PLATE_FITS)[number];
export type DomeScenePlatePlacement = Schema.Schema.Type<typeof DomeScenePlatePlacementSchema>;
export type DomeScenePlateSource = Schema.Schema.Type<typeof DomeScenePlateSourceSchema>;
export type DomeScenePlateLayer = Schema.Schema.Type<typeof DomeScenePlateLayerSchema>;
export type DomeSceneFrame0 = Schema.Schema.Type<typeof DomeSceneFrame0Schema>;
export type DomeScene = Schema.Schema.Type<typeof DomeSceneSchema>;

export const PROJECT_DEFAULT_DOME_SCENE: DomeScene = {
  version: DOME_SCENE_VERSION,
  projectionMode: "zenith-180",
  surface: defaultProjectionSurface("zenith-180"),
  raster: carrierRasterForAspect("1:1"),
  guideSplit: 1 / 3,
  horizonSplit: 1,
  frame0: {
    plateFit: "contain",
    plateFeather: 0.02,
    activeLayerId: null,
    plateLayers: [],
  },
};

export function cloneDefaultDomeScene(): DomeScene {
  return structuredClone(PROJECT_DEFAULT_DOME_SCENE);
}

export function parseDomeScene(value: unknown): DomeScene {
  const scene = Schema.decodeUnknownSync(DomeSceneSchema)(value, { onExcessProperty: "error" });
  return {
    ...scene,
    surface: cloneProjectionSurface(scene.surface),
    raster: cloneCarrierRaster(scene.raster),
  };
}
