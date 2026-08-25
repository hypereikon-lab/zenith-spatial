import { z } from "zod";
import { SourceProjectionModeSchema } from "./projection-profile.js";

export const DISPLAY_PIPELINE_VERSION = 1;

const finiteNumberSchema = z.number().finite();
const normalizedNumberSchema = finiteNumberSchema.min(0).max(1);
const positiveIntegerSchema = z.number().int().positive();
const projectionModeSchema = SourceProjectionModeSchema;

export const DisplayProfileSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    projectionMode: projectionModeSchema,
    fieldOfViewDegrees: finiteNumberSchema.positive().max(360),
    masterWidth: positiveIntegerSchema,
    masterHeight: positiveIntegerSchema,
    fps: finiteNumberSchema.positive(),
    orientationDegrees: finiteNumberSchema,
    safeRimRadius: normalizedNumberSchema,
  })
  .strict();

export const VenueSourceRegionSchema = z
  .object({
    x: normalizedNumberSchema,
    y: normalizedNumberSchema,
    width: normalizedNumberSchema.positive(),
    height: normalizedNumberSchema.positive(),
  })
  .strict()
  .superRefine((region, ctx) => {
    if (region.x + region.width > 1.000001) {
      ctx.addIssue({ code: "custom", path: ["width"], message: "source region exceeds the master width" });
    }
    if (region.y + region.height > 1.000001) {
      ctx.addIssue({ code: "custom", path: ["height"], message: "source region exceeds the master height" });
    }
  });

export const VenueBlendSchema = z
  .object({
    left: normalizedNumberSchema,
    right: normalizedNumberSchema,
    top: normalizedNumberSchema,
    bottom: normalizedNumberSchema,
  })
  .strict();

export const VenueWarpPointSchema = z
  .object({
    sourceX: normalizedNumberSchema,
    sourceY: normalizedNumberSchema,
    outputX: normalizedNumberSchema,
    outputY: normalizedNumberSchema,
  })
  .strict();

export const VenueChannelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    width: positiveIntegerSchema,
    height: positiveIntegerSchema,
    sourceRegion: VenueSourceRegionSchema,
    blend: VenueBlendSchema,
    warpMesh: z.array(VenueWarpPointSchema),
  })
  .strict();

export const VenueProfileSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    displayProfileId: z.string().min(1),
    geometry: z.enum(["dome", "cave", "cylinder", "custom"]),
    calibrationRevision: z.string(),
    channels: z.array(VenueChannelSchema).min(1),
    updatedAt: z.string(),
  })
  .strict()
  .superRefine((venue, ctx) => {
    const ids = new Set<string>();
    venue.channels.forEach((channel, index) => {
      if (ids.has(channel.id)) {
        ctx.addIssue({ code: "custom", path: ["channels", index, "id"], message: "channel IDs must be unique" });
      }
      ids.add(channel.id);
    });
  });

export const DisplayPipelineSchema = z
  .object({
    version: z.literal(DISPLAY_PIPELINE_VERSION),
    activeDisplay: DisplayProfileSchema,
    venueProfiles: z.array(VenueProfileSchema),
    selectedVenueProfileId: z.string().nullable(),
  })
  .strict()
  .superRefine((pipeline, ctx) => {
    const ids = new Set<string>();
    pipeline.venueProfiles.forEach((profile, index) => {
      if (ids.has(profile.id)) {
        ctx.addIssue({ code: "custom", path: ["venueProfiles", index, "id"], message: "venue IDs must be unique" });
      }
      ids.add(profile.id);
      if (profile.displayProfileId !== pipeline.activeDisplay.id) {
        ctx.addIssue({
          code: "custom",
          path: ["venueProfiles", index, "displayProfileId"],
          message: "venue must reference the active display profile",
        });
      }
    });
    if (pipeline.selectedVenueProfileId && !ids.has(pipeline.selectedVenueProfileId)) {
      ctx.addIssue({
        code: "custom",
        path: ["selectedVenueProfileId"],
        message: "selected venue profile does not exist",
      });
    }
  });

export type DisplayProfile = z.infer<typeof DisplayProfileSchema>;
export type VenueSourceRegion = z.infer<typeof VenueSourceRegionSchema>;
export type VenueChannel = z.infer<typeof VenueChannelSchema>;
export type VenueProfile = z.infer<typeof VenueProfileSchema>;
export type DisplayPipeline = z.infer<typeof DisplayPipelineSchema>;

export function createDefaultDisplayPipeline({
  projectionMode = "zenith-180",
  fps = 24,
}: {
  projectionMode?: DisplayProfile["projectionMode"];
  fps?: number;
} = {}): DisplayPipeline {
  return {
    version: DISPLAY_PIPELINE_VERSION,
    activeDisplay: {
      id: "display-primary",
      label: projectionMode === "hall-double-gable" ? "Canonical hall carrier" : "Canonical dome master",
      projectionMode,
      fieldOfViewDegrees:
        projectionMode === "zenith-230"
          ? 230
          : projectionMode === "cave-270"
            ? 270
            : projectionMode === "hall-double-gable"
              ? 360
              : projectionMode.startsWith("cylinder-")
                ? 360
                : 180,
      masterWidth: 2048,
      masterHeight: 2048,
      fps,
      orientationDegrees: 0,
      safeRimRadius: projectionMode === "hall-double-gable" ? 1 : 0.96,
    },
    venueProfiles: [],
    selectedVenueProfileId: null,
  };
}
