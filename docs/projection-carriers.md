# Projection Carriers

Zenith treats a projection image as a spatial contract, not as an ordinary camera picture. The persisted mode names the JSON-safe contract; TypeScript owns authoring metadata and normalization; portable TypeGPU functions own numerical transforms and run unchanged as CPU functions or resolved WGSL.

## Authority and execution

| Concern                             | Authority                                                            | Responsibility                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Portable mode identity and defaults | `src/lib/shared/contracts/projection-profile.ts`                     | JSON-safe schema, migration-safe mode names, and default guide values.                               |
| Carrier registry                    | `src/geometry/projection-carrier-profile.ts`                         | Descriptive topology, center, coverage, guide limits, and render target.                             |
| Numerical compiler                  | `src/geometry/projection-kernel-parameters.ts`                       | One explicit typed projection value from mode, raster, guide allocation, and measured surface.       |
| Portable transforms                 | `src/kernels/projection`, `src/kernels/plates`, `src/kernels/guides` | CPU-callable and WGSL-resolvable forward/inverse, placement, warp, fitting, and carrier coordinates. |
| Raster-allocation normalization     | `src/geometry/source-guide-semantics.ts`                             | Mode-aware seam, cap, and carrier split constraints.                                                 |
| Physical and semantic anchors       | `src/lib/shared/contracts/projection-authoring.ts`                   | Derived physical horizon, explicit calibration, and the independent semantic field location.         |
| GPU execution                       | `src/plates/*shader.ts`, `src/graphics/typegpu/*pipeline.ts`         | Typed raster/texture entry points and pipelines that resolve the portable kernels through TypeGPU.   |
| Image handoff                       | `src/plates/plate-guide-shader.ts`, `src/inpaint/inpaint-prompts.ts` | The committed guide raster and model language derived from the same explicit projection value.       |
| Per-image history                   | `ImageSpatialSpec` on immutable Plate Commits and Image Takes        | The projection, fit, guides, orientation, and target geometry of that exact image.                   |

`projectionCarrierProfile(mode)` is the descriptive registry. `compileProjectionKernelParams(...)` is the numerical boundary. It replaces the former packed room/observer vectors and negative-angle mode sentinels with named `u32` identities and named `f32` geometry. CPU selectors call the kernel functions directly; typed TypeGPU shader entry points resolve those same function bodies to WGSL. Presentation code may still sample textures, use derivatives, and draw optional diagnostic contours, but it does not reimplement projection or plate mathematics.

## Measured surfaces and carrier rasters

Surface geometry and image raster geometry are independent contracts:

- `ProjectionSurface` currently represents an observer-centred angular surface, a measured rectangular room (`width`, `depth`, `height`, `eyeX`, `eyeHeight`, `eyeZ`), a measured circular cylinder (`radius`, `height`, `eyeHeight`), or an extruded profiled hall (`length`, `width`, ordered `roofProfile`, and observer coordinates). The physical horizon is derived at `0°` for angular surfaces and at `eyeHeight` above the venue floor for measured surfaces. Serialized horizon anchors preserve the resolved value for old archives and portable PNGs; any difference from the derived value is an explicit calibration offset. The independent semantic anchor and source-raster splits retain their own responsibilities. Each pair of neighbouring hall-profile anchors is one exact planar roof face.
- `CarrierRaster` selects an exact image-authoring aspect and pixel size. Zenith supports 21:9, 16:9, 4:3, 1:1, 3:4, and 9:16. Raster aspect changes sampling allocation; it does not change the room's physical proportions.
- GPT Image rasters are multiples of 16, keep every edge below 3840 px, remain at or below 3:1, stay inside the documented total-pixel range, and do not exceed the guide's 3,686,400-pixel experimental threshold. Paid preflight rejects an arbitrary image size that does not match one of the exact shared families instead of silently choosing the nearest ratio.

| Aspect | Image authoring raster |
| ------ | ---------------------- |
| 21:9   | 2912 × 1248            |
| 16:9   | 2560 × 1440            |
| 4:3    | 1920 × 1440            |
| 1:1    | 1920 × 1920            |
| 3:4    | 1440 × 1920            |
| 9:16   | 1440 × 2560            |

Paid image preflight decodes the committed input and returned output and requires both to match the exact pinned carrier raster. Zenith never silently relabels or resizes a different aspect.

The current measured-room authoring contract is deliberately exact about the surfaces it represents: rectangular prisms, centred circular cylinders, and one extruded piecewise-planar hall shell. A general irregular polygonal room, curved freeform wall, roof varying along the extrusion axis, off-axis cylinder, projector lens, warp mesh, or blend mask still needs a calibrated surface/mesh contract; Zenith does not pretend that a few dimensions describe those venues.

`Audience in Space` is a separate inspection contract. It derives a perspective camera from a movable human position in venue coordinates (`X`, `Z`, and eye height in metres), while the persistent projection observer remains the origin used by carrier transforms and the source of the authored physical horizon. CAVE, hall, and cylinder previews use their measured dimensions directly. Angular carriers are dimensionless by definition, so the workspace supplies a physical dome radius solely for scale simulation. Moving this inspection audience pose never rewrites the measured surface, physical horizon, source allocation, Plate placement, commits, or pixels.

## Supported topologies

### Circular fisheye

`zenith-180`, `zenith-230`, and `nadir-180` are circular equidistant maps. Radius encodes polar angle and azimuth is continuous around the center. Pixels outside the source circle are protected black exterior. The physical horizon is observer level at `0°`; a non-zero elevation is explicitly an installation calibration. The semantic field elevation remains artist-authored, while the image-horizon split independently allocates pixels around the physical latitude. The 230-degree profile may retain content below the 180-degree rim.

On a non-square carrier raster, an angular fisheye remains a true circle in pixel space with diameter equal to the short edge. The extra long-axis area stays protected black. Changing 1:1 to 21:9 therefore allocates a wider generation canvas without falsely stretching dome directions into an ellipse.

### CAVE square-perimeter continuity carrier

`cave-270` is a normalized square-perimeter topology for one floor and four continuous walls. The center region is the floor; moving outward crosses the floor/wall seam and traverses the wall height; angle around the center selects the room perimeter. It is not a panorama, room render, cube map, or domemaster. The normalized topology may be sampled into any supported rectangular carrier raster; that stretches sampling density, not the measured room.

The CPU map intersects a ray from the configured observer with the floor or nearest wall. Width, depth, height, and observer offsets are profile inputs instead of shader constants. The inverse maps the physical hit back to the same source coordinate. The physical-horizon plane follows observer eye height above the venue floor. Advanced calibration may offset that plane for a surveyed installation mismatch without pretending it is a normal artistic control. A separate image-horizon percentage decides how many source pixels are allocated on either side of the resolved plane.

### Profiled planar hall shell carrier

`hall-double-gable` is the migration-stable mode ID for an observer-centred carrier with an arbitrary extruded piecewise-planar roof, four vertical walls, and explicitly no floor. The artist authors an ordered cross-hall profile of 3–8 anchors; every adjacent pair defines one exact roof plane. The old double-gable shape is now only the default five-anchor preset. The carrier uses the same continuity principle as CAVE but reverses the cap responsibility:

- the carrier center is the roof point directly above the observer;
- the inner square contains the complete authored roof profile;
- the inner boundary is the continuous roof-to-wall seam;
- the outer carrier band traverses upper wall → resolved physical horizon → lower wall;
- the raster edge is the physical bottom edge of the walls and remains the open boundary toward the omitted floor;
- traversal around the center follows the complete wall perimeter, preserving all four corners.

The default dimensions reproduce the supplied hall reference: 22.55 m length, 23.143 m width, with normalized cross-hall anchors at 0%, 25%, 50%, 75%, and 100%, 9.39 m eaves/valley, and 12.93 m ridges. Artists may move internal anchors, add or remove folds, change every height independently, and move the observer. The schema requires 3–8 strictly ordered anchors spanning exactly 0–100% and keeps the observer inside the extrusion and below the complete roof profile.

For a direction from the observer, the inverse evaluates every active roof plane—up to seven—plus all four walls and chooses the nearest positive hit. A straight-down ray is invalid because there is no floor to receive it. The forward carrier map places roof coordinates in the inner band and wall coordinates outside it. Forward/inverse functions, profile interpolation, and segment selection share portable TypeGPU bodies between CPU editing and WebGPU rendering; the physical Volume Room mesh is built from the same measurements.

This is a continuous spatial carrier, not an unwrapped panel atlas. All authored roof quadrilaterals and four walls appear as one warped texture in Plate Map and as the measured shell in Volume Room. GPT Image prompting enumerates the authored eaves, ridges, valleys, and breaks with normalized cross-hall positions and physical heights; it also names the roof/wall seam, wall corners, and open floor edge, and explicitly forbids inventing a floor or returning a perspective building render.

## Continuous carrier field and diagnostic overlays

The model-facing Plate guide is a continuous positional field, not a drawing of the venue. Four semantic color anchors describe carrier traversal, and a seam-continuous periodic hue component communicates azimuth or perimeter direction without introducing black rays. The profiled hall treats its inner roof square differently from a CAVE floor cap: it evaluates the physical roof-height function `H(z)` at every source sample. Lower eaves and valleys receive the low roof tone, higher ridges receive the high tone, and linear roof planes become continuous longitudinal rise/fall bands. The field therefore exposes the authored ridge wave without suggesting a false square-radial cross or baking ridge lines into the inpaint input.

Exact rings, spokes, seams, roof-profile breaks, and surface edges are derived isolines. They belong only to the toggleable Guides/Edge editor overlays and physical review diagnostics. On the hall Plate Map, Edge derives each roof-break contour by mapping the source sample back onto the measured roof and comparing its world-space `z` against the active profile anchors. Clean view, committed Plate Sketch handoff, GPU composition output, and inpaint input contain no baked construction lines. This separation lets an artist inspect topology precisely without asking the image model to erase a grid it should never have received.

There are therefore six deliberately separate concepts:

1. The measured surface defines physical geometry.
2. The observer pose defines the origin used by projection rays and physical preview.
3. The physical horizon is derived from observer level and carrier geometry.
4. An optional advanced calibration offsets that physical guide for surveyed installations.
5. Semantic anchors and image splits allocate the artistic field and source resolution independently.
6. Optional contours expose exact locations for human inspection.

### Circular cylinder continuity carrier

`cylinder-nadir` and `cylinder-zenith` turn the same spatial idea into a normalized circular, continuous cylinder carrier:

- azimuth around the source center is azimuth around the cylinder;
- a small positive center disk contains the complete floor or ceiling cap;
- the cap boundary joins continuously to the wall annulus;
- radius through the annulus traverses the full wall height;
- the physical horizon follows observer eye height, with only an explicit advanced calibration offset;
- the normalized outer circle is the opposite wall edge;
- the exterior corners remain pure black.

On a non-square raster, the normalized circle is sampled across both axes and therefore appears as an ellipse touching all four edge midpoints. This is the exact invertible source-map parameterization, not a stretched camera subject. Plate composition, canonical image fitting, guide generation, CPU transforms, GPU masking, and prompt language all use that ellipse. Using a min-side pixel circle here would discard valid cylinder-wall source area.

For the nadir profile, radial traversal is floor cap → lower wall → eye horizon → upper wall. The zenith profile reverses the physical vertical traversal: ceiling cap → upper wall → eye horizon → lower wall. Switching between them therefore flips vertical plate meaning while preserving azimuthal continuity.

The cap radius cannot be zero. At zero, every point on the physical cap would collapse to one source coordinate, so the map would stop being invertible. Zenith defaults to `0.02`, permits `0.005–0.25`, and describes this explicitly in the UI and prompt. A very small cap gives the desired circle-to-cylinder expansion while retaining a defined inverse and enough pixels for generation and filtering.

## Cylinder mapping

Let the normalized source coordinate relative to its center be `(x, y)`, with radius `rho = sqrt(x² + y²)` and azimuth `a = atan2(x, y)`. Let `c` be the cap raster split, `h` the image horizon split, and `H` the resolved physical horizon height: observer eye height plus any explicit calibration offset.

For `rho <= c`, the source maps linearly across the cap:

```text
capRadius = cylinderRadius * rho / c
surface = (sin(a) * capRadius, capY, cos(a) * capRadius)
```

For `rho > c`, the point lies on the wall at the cylinder radius. Source radius maps piecewise linearly to physical vertical traversal `t`; the first interval maps `c..h` to cap edge..`H`, and the second maps `h..1` from `H` to the opposite edge. The inverse applies the opposite piecewise map. Observer height affects the ray origin; `H` affects texture placement; `h` affects sampling density.

Ray-to-surface evaluation tests both the cap plane and cylinder wall and chooses the nearest valid positive intersection. Tests cover UV → surface → UV, direction → surface → UV, both cap orientations, editable room proportions, derived and calibrated physical horizons, circular-domain rejection, and cap singularity prevention.

### Unwrapped cylinder-wall carrier

`cylinder-wall` is an additive wall-only topology. It does not replace the radial carriers and deliberately does not represent a floor or ceiling cap:

- source X traverses 360-degree azimuth around the cylinder;
- source Y traverses the wall from ceiling at the top edge to floor at the bottom edge;
- the left and right source edges are identified as the same physical vertical seam;
- every source pixel belongs to the wall, with no circular mask or protected corner exterior;
- the editable lower/upper image allocation maps rows below and above the derived physical horizon.

Zenith governs this model-facing carrier at 21:9: 2912 × 1248. That width is used for circumferential evidence instead of spending a square image on wall height. The topology, aspect selector, generated prompt, and paid preflight share this policy. Older non-21:9 cylinder-wall Plates remain readable as historical state, but Zenith requires the artist to rebuild and recommit the Plate at 21:9 before another paid image generation.

For normalized source coordinates `(u, v)`, azimuth is `a = (u - 0.5) * 2π`. The bottom-to-top carrier traversal is `c = 1 - v`. A piecewise-linear map sends the configured image-horizon split to the resolved physical-horizon height fraction. The surface point is then:

```text
surface = (sin(a) * cylinderRadius, wallY(c), cos(a) * cylinderRadius)
```

The inverse recovers azimuth and physical wall height, then applies the inverse eye-level allocation. `u = 0` and `u = 1` produce the same physical wall line. Plate composition evaluates both edges from the same direction, the physical WebGPU preview samples U periodically, and the inpaint guide/prompt require matching edge content, so seam continuity is an explicit authoring, filtering, and generation constraint rather than an accidental crop boundary.

Cylinder Wall continuity is an image-generation obligation, not a projection patch. The committed Plate Sketch canvas is asserted to match its pinned carrier raster before PNG encoding; paid execution decodes the actual input bytes before confirmation; and result capture decodes the returned bytes before attachment. For the governed carrier, input, requested output, and returned result must all be exactly 2912×1248. The prompt registers one shared input/output pixel grid and models columns 2911 and 0 correctly as consecutive samples on a half-open periodic ring, not duplicate samples. Its edit contract separates detailed authored pixels from the smooth guide field, protects authored evidence in the outer 10% strips from independent regeneration, permits only guide-field replacement there, and requires a three-copy tiled verification whose boundary transition is compared with the ordinary adjacent-column transitions on both sides. Volume Room then repeat-samples the single returned image without altering its pixels, so a visible join remains honest feedback for the next prompt iteration.

This topology uses wide rasters much more efficiently for wall content. Its tradeoff is equally explicit: cap-to-wall continuity is absent. Use `cylinder-nadir` or `cylinder-zenith` when the artwork must cross continuously between a cap and wall; use `cylinder-wall` when wall resolution and a conventional 360-degree wrap are the stronger requirement.

## Plate compensation

A Plate placement stores semantic polar position, not an accidental pixel offset. When an artist changes a topological seam, cap split, image-horizon split, carrier raster, measured geometry, or observer height, Zenith remaps the Plate through physical space and back through the new allocation. The artwork therefore stays on the same projected location while source pixels are redistributed. Moving the semantic anchor or an explicitly unlocked physical-horizon calibration is intentionally different: it changes the field or texture-to-surface mapping, so Zenith leaves Plate coordinates, observer pose, and camera untouched.

Changing zenith-oriented to nadir-oriented meaning also flips the vertical plate orientation. This avoids forcing the artist to repair a horizon move or top/bottom reversal later in finishing.

## Composition and image boundaries

Projection metadata belongs to every immutable Plate Commit and Image Take. Review resolves the explicitly selected item's `ImageSpatialSpec`, so independent images may use different projection modes, measured surfaces, carrier rasters, field allocations, fits, rotations, and horizon positions without inheriting the current editor setting. Carrier-aware conform preserves a true angular pixel circle while stretching normalized CAVE/cylinder/hall UV sampling across a rectangular raster. It does not relabel topology, measured surface, or carrier anchors: those are authored upstream and require a new Plate Commit or Image Take.

Paid image generation pins a versioned provenance contract before confirmation: the owning Project and Composition, exact Plate Commit, carrier raster, complete `ImageSpatialSpec`, strategy, and model. The commit renderer must return a canvas with that exact raster, and the browser decodes the submitted image bytes before confirmation rather than trusting its filename or metadata. The server-authoritative job journal echoes the contract into the output; capture decodes returned bytes and refuses attachment if width or height differs. An Image Take inherits spatial truth from its pinned Plate Commit, never from the mutable draft or current selection. If that commit is no longer selected while generation is running, the result still attaches to its originating Composition and exact parent without replacing another Composition's review selection.

Generated PNG Image Takes also carry the same contract in an uncompressed `zenith.spatial.v1` PNG `iTXt` chunk inserted without decoding or re-encoding pixel data. The immutable take and durable job remain authoritative; embedded PNG metadata is the portable copy used to recover projection state on re-import. A PNG without Zenith metadata inherits the explicitly selected Composition contract and reports that fallback instead of silently claiming a default projection. Prompt language still governs model behavior, but it is never parsed as machine provenance.

Physical projector calibration remains intentionally downstream. A future room specification with projector frusta, lens models, overlap, warp meshes, and blend masks should consume the finished carrier image; it must not alter authored Composition state.

## Model handoff contract

The generated guide and prompt describe the same topology, exact raster, measured surface, and continuous carrier field. The prompt defines the field's semantic anchors and explicitly says that it is positional evidence rather than visible scene content. Every projection mode also receives an always-on semantic plate-integration contract. By default, the Plate Sketch is the authority for carrier topology, subject identity, and authored spatial relationships rather than literal pixels: the model may repaint, relight, locally deform, extend, and partially occlude plate material across permeable boundaries while principal landmarks remain in their authored carrier neighborhoods. The committed frame contributes a per-layer source aspect, center, carrier coordinate, semantic role, scale, rotation, flip, and warp ledger. An optional Strict Pixels strategy retains the earlier locked-mask copy-through behavior for archival cases. In both strategies, detailed green/cyan artwork is distinguished from the analytical field; color alone never makes content disposable.

The generated contract asks the model to perform an ordered internal edit: identify and flood-fill every complete plate silhouette—including smooth sky, fog, water, transparency, and feathered edges—freeze complementary artwork and guide masks, classify every guide pixel into coordinate-defined carrier zones, assign each missing region to a nearby compatible artwork boundary, synthesize behind the protected matte, composite the untouched artwork back at its input coordinates, and reject non-zero artwork displacement in a same-size comparison. The guide remains a continuous gradient, but its authored anchors are explicit semantic partition boundaries during reasoning. For example, the CAVE carrier is decoded as floor, lower-wall, and upper-wall intervals rather than one ambiguous green-to-blue wash.

Artist direction is stored separately from the generated harness and is appended at lower priority. It may direct the subject, material, atmosphere, density, or continuity synthesized inside unresolved field pixels, but it cannot override Plate placement, raster, or topology. The Generate room and paid confirmation both expose the exact compiled prompt.

For radial cylinder carriers, the topology section names the compressed cap, cap/wall seam, wall traversal order, eye horizon, 360-degree azimuth, opposite wall edge, and protected black exterior. For a rectangular radial carrier it explicitly requires the full-frame normalized ellipse rather than a min-side circle. The wall unwrap has a dedicated 21:9 harness: it treats horizontal X as authoritative azimuth, divides the ring into four adjacent quarter-turn neighborhoods, keeps each plate near its authored azimuth and height, assimilates old crop boundaries locally, and verifies the left/right edge as a horizontally tiled identified seam. It explicitly rejects centered photographic composition, invented caps, circular masks, and hidden seam patches. Profiled-hall prompts enumerate every roof anchor and require continuity through all planes. Angular prompts retain a true short-edge pixel circle and black long-axis margins. CAVE prompts state that the full rectangular carrier is a sampling layout, not a camera aspect. No variant asks the model to preserve or erase baked rings, spokes, grids, seams, or construction marks, because the committed guide contains none. All variants reject a perspective room render or accidental reframing.

This language is geometry, not style. Subject, material, lighting, and artistic direction remain free. The model is being asked to complete a warped source texture that will become continuous when projected.

## Adding a carrier

Add a new carrier only as one complete vertical slice:

1. Add a JSON-safe mode and defaults to the shared contract.
2. Add one registry profile with topology, center, valid guide ranges, surface parameters, and render target.
3. Implement one portable TypeGPU forward/inverse transform and round-trip-test its CPU execution and WGSL resolution.
4. Route carrier-field normalization and Plate compensation through physical space.
5. Extend the explicit kernel parameter schema, compiler, typed GPU binding, and resolved shader entry points.
6. Add Plate Map, physical-volume review, continuous inpaint field, prompt semantics, and optional contour overlays.
7. Persist the mode on each Plate Commit and Image Take and verify save/load.
8. Verify pure math, type boundaries, WebGPU rendering, and the live workstation.

No carrier is complete when it exists only in a menu, only in a shader, or only in prompt text.
