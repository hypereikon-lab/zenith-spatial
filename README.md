# Zenith

Zenith is a local spatial-image workbench for immersive projection. Its product loop is intentionally narrow:

1. **Compose** source images into a projection-aware Plate Sketch.
2. **Inpaint** that committed Plate Sketch into one continuous carrier image.
3. **Project** the exact returned pixels into a dome, CAVE, cylinder, or measured hall for review.

The default composition and source plates are ready on launch. A project may contain multiple independent Compositions, but Zenith is not currently a timeline, motion generator, NLE, or delivery system.

## Product model

A Composition owns an ordered source set, an editable placement/warp document, an immutable committed Plate Sketch revision, finished-image revisions, and the spatial metadata belonging to those images.

Changing a Composition after commit makes its generated image stale. Image generation is allowed only from an exact committed Plate Sketch at the exact carrier dimensions. Returned PNGs retain Zenith provenance, remain downloadable at native resolution, and are projected without hidden seam correction or raster rewriting.

## Projection carriers

Zenith supports:

- Zenith 180° and 230° fisheye;
- Nadir 180° fisheye;
- CAVE perimeter/floor carrier;
- cylinder with nadir or zenith cap;
- 21:9 cylinder wall unwrap;
- measured planar-profile hall with an arbitrary roof anchor profile.

Carrier topology, raster allocation, venue geometry, observer pose, texture horizon, field anchors, CPU math, WGSL execution, prompt language, and persisted metadata are separate concepts. See [projection carriers](docs/projection-carriers.md).

## Image generation

The paid action sends the committed Plate Sketch as the sole spatial/layout authority, the original Plate sources as separately tagged appearance references, the projection-aware compiled prompt, artist direction, and pinned spatial/revision provenance. The original sources may govern content identity, material, and visual medium, but never override authored placement or carrier topology. The browser receives a short-lived server confirmation grant before creating the job. Secrets and upstream calls remain server-only. Automated tests never press paid confirmation.

The default **Integrated** strategy preserves content identity and placement while allowing local repainting through plate boundaries. **Strict pixels** remains available for archival copy-through.

## Development

    npm install
    npm run dev

Checks:

    npm run lint
    npm run typecheck
    npm test
    npm run build

The app uses SvelteKit, TypeScript, Zod, Vitest, TypeGPU/WebGPU, and adapter-node. Tests live beside the code they protect; there is no CI/CD or browser-test harness.

## Repository boundaries

| Area                                    | Responsibility                                             |
| --------------------------------------- | ---------------------------------------------------------- |
| src/ui                                  | Compose, Inpaint, Project, and artist-facing controls      |
| src/artifacts                           | Reactive workbench state and runtime media handles         |
| src/sequence                            | Composition library and immutable image revisions          |
| src/plates                              | Placement, warping, guides, compositing, and commit        |
| src/geometry, src/kernels, src/graphics | Projection math and CPU/GPU rendering                      |
| src/inpaint                             | Projection-aware image prompt compiler                     |
| src/app                                 | Browser commands, persistence, preflight, and confirmation |
| src/lib/shared                          | JSON-safe portable contracts                               |
| src/lib/server, src/routes/api          | Server-only image jobs and model integration               |
| src/media                               | Image metadata, normalization, and downloads               |

## Environment

Create .env.local locally; never commit it.

- RUNWAYML_API_SECRET: required for paid image generation.
- RUNWAY_API_BASE, RUNWAY_API_VERSION: optional upstream overrides.
- ZENITH_JOB_STORE_DIR, ZENITH_JOB_RETENTION_DAYS, ZENITH_JOB_MAX_RECORDS: optional job persistence controls.

## Current limits

- Projection review requires WebGPU.
- Venue geometry is not yet a projector-by-projector calibration/export system.
- The composition library is unordered by time. Motion and editing can return as separate, evidence-backed products that consume finished spatial images.
