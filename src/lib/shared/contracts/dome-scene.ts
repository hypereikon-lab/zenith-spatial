import { z } from "zod";
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

const finiteNumberSchema = z.number().finite();

const DomeScenePlateCornerOffsetSchema = z.object({ x: finiteNumberSchema, y: finiteNumberSchema }).strict();

const DomeScenePlateCornerOffsetsSchema = z
  .object({
    nw: DomeScenePlateCornerOffsetSchema,
    ne: DomeScenePlateCornerOffsetSchema,
    se: DomeScenePlateCornerOffsetSchema,
    sw: DomeScenePlateCornerOffsetSchema,
  })
  .strict();

export const DomeScenePlatePlacementSchema = z
  .object({
    azimuth: finiteNumberSchema,
    radius: finiteNumberSchema,
    scale: finiteNumberSchema,
    spin: finiteNumberSchema,
    opacity: finiteNumberSchema,
    flipX: z.boolean().optional().default(false),
    flipY: z.boolean().optional().default(false),
    cornerOffsets: DomeScenePlateCornerOffsetsSchema,
  })
  .strict();

export const DomeScenePlateSourceSchema = z
  .object({
    assetId: z.string().min(1).optional(),
    name: z.string().min(1),
    width: finiteNumberSchema,
    height: finiteNumberSchema,
    aspect: finiteNumberSchema,
    url: z
      .string()
      .refine((url) => !url.startsWith("blob:"), "object URLs are runtime-only and cannot be stored in Dome Scene")
      .optional(),
    mime: z.string().optional(),
  })
  .strict();

export const DomeScenePlateLayerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    index: finiteNumberSchema,
    source: DomeScenePlateSourceSchema,
    placement: DomeScenePlatePlacementSchema,
    visible: z.boolean().optional().default(true),
    locked: z.boolean().optional().default(false),
  })
  .strict();

export const DomeSceneFrame0Schema = z
  .object({
    plateFit: z.enum(DOME_SCENE_PLATE_FITS).optional().default("contain"),
    plateFeather: finiteNumberSchema.optional().default(0.02),
    activeLayerId: z.string().nullable().optional().default(null),
    plateLayers: z.array(DomeScenePlateLayerSchema),
  })
  .strict();

export const DomeSceneSchema = z
  .object({
    version: z.literal(DOME_SCENE_VERSION),
    projectionMode: z.enum(DOME_SCENE_PROJECTION_MODES),
    surface: ProjectionSurfaceSchema,
    raster: CarrierRasterSchema,
    guideSplit: finiteNumberSchema,
    horizonSplit: finiteNumberSchema,
    frame0: DomeSceneFrame0Schema,
  })
  .strict()
  .superRefine((scene, ctx) => {
    if (!projectionSurfaceMatchesMode(scene.surface, scene.projectionMode)) {
      ctx.addIssue({
        code: "custom",
        path: ["surface"],
        message: `surface kind ${scene.surface.kind} does not match projection mode ${scene.projectionMode}`,
      });
    }
  })
  .transform((scene) => ({
    ...scene,
    surface: cloneProjectionSurface(scene.surface),
    raster: cloneCarrierRaster(scene.raster),
  }));

export type DomeSceneProjectionMode = (typeof DOME_SCENE_PROJECTION_MODES)[number];
export type DomeScenePlateFit = (typeof DOME_SCENE_PLATE_FITS)[number];
export type DomeScenePlatePlacement = z.infer<typeof DomeScenePlatePlacementSchema>;
export type DomeScenePlateSource = z.infer<typeof DomeScenePlateSourceSchema>;
export type DomeScenePlateLayer = z.infer<typeof DomeScenePlateLayerSchema>;
export type DomeSceneFrame0 = z.infer<typeof DomeSceneFrame0Schema>;
export type DomeScene = z.infer<typeof DomeSceneSchema>;

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
  return DomeSceneSchema.parse(value);
}
