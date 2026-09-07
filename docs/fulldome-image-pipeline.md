# Fulldome image preparation

Zenith owns one narrow, deterministic stage between curated references and an external image model:

```text
curated pair or trio
  -> assign one source to the large upper slot
  -> arrange the remaining sources across the front
  -> optionally inspect or edit in Compose
  -> render the exact metadata-bearing PNG
  -> send that PNG to GPT Image 2.5 in ChatGPT Images
```

The layout does not classify or describe image content. Curation supplies the one semantic decision: which source is
dominant. Zenith supplies projection-aware placement only. The `upper-dominant-radial-v3` layout reproduces the
authored two-plate Workbench composition by default. Three-source bundles retain a separate balanced radial profile
instead of extrapolating the asymmetric pair. Secondary sources remain substantial rather than collapsing into
thumbnails.

## Workbench use

1. Select **Load curated bundle** and choose exactly two or three source images. This replaces only the editable Plate
   sources; existing commits and takes remain intact.
2. The first imported source is initially assigned to the large upper slot.
3. Under **Fulldome bundle**, change the **Large upper source** if necessary.
4. Choose **Upper + front** or its spatially mirrored form.
5. Select **Arrange fulldome bundle** after changing either assignment.
6. Inspect or refine the editable placements.
7. Select **Download exact PNG**.

The existing exact export remains authoritative. It renders at the selected carrier raster and embeds the complete
`zenith.plate.v1` draft and spatial contract without re-encoding the composed pixels afterward.

## Headless composition

The full Zenith interface is optional. The workbench-free kernel accepts two or three ordinary image files and
returns the exact 1920×1920 PNG plus an explicit manifest. It does not construct React, read selected UI state, open
the Workbench, or traverse a media repository.

Copy `docs/fulldome-compose-job.example.json` to a private location, replace its paths, and run:

```sh
npm run fulldome:compose -- --job /absolute/path/fulldome-compose-job.json
```

The command writes the requested PNG and a sibling `<output>.manifest.json`. `--dry-run` validates paths, bundle
size, dominant assignment, and orientation without starting the renderer. The default two-source profile is the
authored Zenith Workbench arrangement: a large upper source at azimuth `-14.6223`, radius `0.6058`, scale `2.17`,
and spin `0.8719`; plus a substantial front source at azimuth `157.3278`, radius `0.5176`, scale `1.55`, and spin
`-22.238`. Three-source bundles retain their independent front-left/front-right slots rather than extrapolating the
two-source composition:

```sh
npm run fulldome:compose -- --job /absolute/path/fulldome-compose-job.json --dry-run
```

For repeated composition, keep the local API warm:

```sh
npm run fulldome:api
curl --fail-with-body \
  --header 'content-type: application/json' \
  --data-binary @/absolute/path/fulldome-compose-job.json \
  http://127.0.0.1:4181/api/fulldome/compose
```

`POST /api/fulldome/compose` returns `{ schema, pngBase64, manifest }`; `GET /api/fulldome/health` reports whether
the renderer is cold or warm. The API deliberately binds only to `127.0.0.1`: its inputs are local file paths and it
is an internal pipeline boundary, not a public upload service.

The implementation has three layers:

- `composeFulldomePlateBundlePng(...)` is the UI- and service-independent TypeScript kernel.
- `fulldome-compose.html` is a minimal internal WebGPU harness with no React or Workbench UI.
- `scripts/fulldome-compose-api.mjs` serializes requests through one reusable headless renderer; the CLI is a small
  client of that same API.

Zenith's existing WebGPU compositor remains the single rendering implementation. Headless operation reuses it
instead of porting projection math to a second renderer.

## Provenance contract

Each source may declare `directReferences`: only the files used immediately to create that source. These references
are hashed and deduplicated by SHA-256. A generated source may additionally point to its `generationReceipt`, which
pins the Runway request and its two outputs. When that finalized receipt is present, the compositor verifies that it
actually produced the selected plate and derives its direct references automatically; they do not need to be copied
into the compose job. Zenith records exactly those direct edges and does not recursively import the references' own
ancestry.

Local source paths are retained only in the external JSON manifest. They are not embedded into the exported PNG.
The PNG continues to embed the normal `zenith.plate.v1` spatial metadata required for exact reopening and
projection-aware handoff.

## In-process automation boundary

Import the narrow facade at `src/runtime/fulldome-image-pipeline.ts` rather than reproducing layout or export logic:

- `arrangeFulldomeBundle(...)` is the pure geometry operation.
- `composeFulldomePlateBundlePng(...)` is the preferred standalone operation and does not require a service layer.
- `prepareFulldomePlateBundle(...)` atomically replaces the editable sources and arranges a selected pair or trio.
- `arrangeFulldomePlateBundle(...)` applies it to the selected Workbench composition.
- `renderExactPlateDraftPng(...)` returns the exact PNG as a `Blob` instead of initiating a browser download.
- `prepareAndRenderFulldomePlateBundlePng(...)` performs import, layout, source decoding, and exact export as one
  Effect operation. It does not wait for React state and is the preferred automation entry point.

The renderer remains browser/WebGPU-owned. An in-process caller supplies a preview session and receives the PNG
`Blob`; the local API manages that session automatically. Both paths accept ordinary browser `File` values, so a
Drive adapter only needs to materialize each selected binary with its original filename and MIME type. Drive
credentials and folder traversal remain outside Zenith.

## Runway ecosystem synthesis

Each Runway MCP request produces exactly two images. Copy `docs/runway-image-job.example.json` to a private runtime
directory and create the prepared request before calling the Runway connector:

```sh
npm run runway:receipt -- --job /absolute/path/runway-job.json --stage prepare
```

The MCP call must use the same prompt, ordered reference images, model, ratio, and `count: 2` from that request. Once
the two original outputs have been saved, add the returned Runway task id(s), optional asset ids, and observed credit
use to the job, then finalize:

```sh
npm run runway:receipt -- --job /absolute/path/runway-job.json --stage finalize
```

The final receipt records the exact prompt and hash, ordered source hashes, provider task ids, two output hashes, and
the prepared-request hash. Signed asset URLs are intentionally not persisted. The Runway connector charges the
connected workspace's normal model credits; no separate MCP surcharge is represented by this pipeline, although
Runway pricing remains provider-controlled.

Runway is a strict MCP boundary: the production path does not click through the Runway interface, call private web
routes, or fall back to an Unlimited queue. If the connector is absent or returns an unknown-tool error, the state
remains `runway-ready` and no provider call is attempted. Restoring the connector is safer than silently changing
transport, account, cost mode, or idempotency semantics.

## Pixel-vision reference gate

Paid requests can set `requireReferenceReview: true`. In that mode, preparation requires a
`referenceReviewReceipt` created with:

```sh
npm run reference:review -- --input /absolute/path/review-input.json --output /absolute/path/reference-review.json
```

The receipt binds each decision to the exact image SHA-256. Every source reference sent to Runway must be present
and approved; an unreviewed, rejected, changed, or ambiguously classified source blocks only its own campaign state.
For the later ChatGPT handoff, set `referenceReviewScope: "source-references"` to verify the original Atlas/Drive
references inherited through provenance while allowing the generated Runway images and composed Plate Sketch to
remain derived artifacts rather than pretending they received a second source-corpus review. The legacy
`all-attachments` scope remains available when a job genuinely requires every attachment to be reviewed.
The natural-world policy rejects people, boats, vehicles, roads, constructed paths, boardwalks, stairs, bridges,
handrails, buildings, utilities, signage, prominent text, logos, and watermarks. Uncertainty is a rejection, not an
implicit approval. This review is pixel-based: filenames, tags, embeddings, and Atlas scene membership are useful
for retrieval but never substitute for looking at the candidate image.

## ChatGPT Images in-app handoff

GPT Image 2.5 beta is currently used through the authenticated ChatGPT product rather than a stable public API. The
production boundary is therefore a prepared handoff executed by Codex in one dedicated **in-app browser** tab. It
does not open external Chrome windows, use a Chrome profile, invoke CDP, depend on Finder, or use mouse coordinates.

Create a private job from `docs/chatgpt-image-handoff.example.json`, then freeze the exact prompt and ordered binaries:

```sh
npm run chatgpt-image -- --job /absolute/path/job.json --stage prepare
```

When `plateManifest` is omitted, the command automatically uses `<plateSketch>.manifest.json` if that sibling exists.
The manifest compiles the browser inputs in this stable order:

1. the Plate Sketch as `Image1`;
2. each image actually placed in the Plate Sketch, in composition order;
3. the direct references used to generate those plate images, grouped by plate and deduplicated globally by SHA-256;
4. any explicit `references` left in the job as supplemental scene evidence.

This is deliberately one provenance edge deep. A generated plate carries the exact direct references and generation
receipt recorded at composition time. A Drive-sourced plate with no known upstream receipt remains a valid leaf: the
system includes the plate itself but does not invent or infer ancestors. If the manifest, Plate Sketch, source image,
direct reference, or generation receipt has drifted, preparation fails before the browser is touched.

`contextPolicy` chooses which contextual evidence is actually sent to GPT Image 2.5:

- `exact` sends the plate sources and their direct generating references;
- `related` sends the plate sources plus a selected Atlas state, while retaining exact ancestry only in provenance;
- `hybrid` sends both exact ancestry and the selected Atlas state.

`sceneContextReceipt` must be an `inside-valdivia.scene-context-selection@1` receipt and `stateIndex` selects one
static or transitional state. Its local rasters and hashes are verified before upload. `additionalReferences` can add
explicitly curated local or Drive material with `sourceKind` and `sceneIds`; these inputs are recorded as
`scene_context_reference`, not retroactively presented as ancestors of a plate. Globally repeated bytes are uploaded
once even when they participate in multiple provenance or conditioning roles.

### Adaptive domemaster reprojection

The default Zenith 180/230 prompt treats the Plate Sketch as a normalized spatial-intent map, not a pixel-registered
image-edit target. The invariant is the polar carrier: a centered true circle, rotationally symmetric equidistant
radial sampling, the zenith at the center, the authored azimuthal order, and the correct horizon meaning. Plate
rectangles, literal pixels, local aspect ratios, precise scale, and exact centers may be repainted or nonlinearly
reprojected as needed to make the content native to that carrier.

This distinction is intentional. GPT Image may return a provider-native square resolution rather than the Plate
Sketch raster, so one-to-one `(x,y)` registration is neither achievable nor desirable for this handoff. Asking for
literal registration also encourages wide source plates to survive as horizontal bands and can turn the zenith field
into an elliptical aperture. The adaptive contract explicitly rejects axis-dependent stretching, ovalized
constant-angle features, visible inner rings, and pasted plate silhouettes while preserving the authored vertical
and azimuthal intention.

The explicit `strict` generation strategy remains available when pixel conservation is genuinely required. Other
carrier families retain their existing integrated contracts; this adaptive behavior is specific to zenith
domemasters.

The prepared `zenith.chatgpt-image-handoff.v1` receipt is the source of truth for the browser operation. Codex then:

```sh
npm run chatgpt-image:serve -- --request /absolute/path/chatgpt-request.json --port 4321
```

The temporary server binds only to `127.0.0.1`, verifies every frozen file hash before starting, and exposes only the
prompt and indexed attachments. It has no arbitrary filesystem route. Codex then:

1. Reuses or opens one clean `https://chatgpt.com/images` tab in the Codex in-app browser.
2. Verifies that ChatGPT Images 2.5 is authenticated and that the composer contains no prior attachments.
3. Copies and pastes the Plate Sketch alone as `Image1` using the in-app browser's binary clipboard.
4. Waits until attachment count is exactly one.
5. Copies and pastes each deduplicated plate source and direct/supplemental reference **one at a time**, waiting for
   count `2…N` after every paste. This
   avoids asynchronous paste reordering. Clipboard uploads receive ChatGPT-generated filenames, so the external
   handoff receipt—not the UI label—is authoritative for identity and order.
6. Fills the exact prepared prompt and reads it back before enabling submission. ChatGPT's contenteditable may turn a
   single line break into a paragraph break, so the UI check uses the recorded whitespace-canonical prompt hash while
   the receipt retains the original byte-exact prompt and hash.
7. Submits exactly once, waits for the generated image to complete, downloads the original bytes, and records the
   resulting `chatgpt.com/c/...` URL.

After adding `conversationUrl` to the job and placing the downloaded output at `output`, finalize provenance:

```sh
npm run chatgpt-image -- --job /absolute/path/job.json --stage finalize
```

Finalization refuses prompt or attachment drift and writes `zenith.chatgpt-image-generation.v2` with the request
digest, exact prompt/hash, Image1/reference hashes, conversation URL, and output hash. Local paths and receipts stay
outside version control.

Pairs and trios intentionally share the same contract. A pair uses `upper-dominant + front-center`; a trio uses
`upper-dominant + front-left + front-right`. Mirroring changes spatial coordinates but never flips source pixels.

## Durable multi-state campaigns

Do not repeat the provider handoff state machine manually for a sequence of images. A campaign manifest binds each
state to its Runway request, Plate composition, and ChatGPT Images handoff. The runner treats provider submission as
an irreversible boundary and all local preparation, verification, composition, and finalization as resumable work.

```sh
npm run image-campaign -- advance-local --campaign /absolute/path/campaign.json
npm run image-campaign -- status --campaign /absolute/path/campaign.json
```

`advance-local` runs every currently possible local step. It prepares all frozen requests, finalizes downloaded
Runway outputs, keeps one warm Plate renderer for the whole batch, prepares all ChatGPT handoffs, and finalizes any
downloaded ChatGPT results. Re-running it is idempotent: an existing request is verified, never silently replaced.
A reference rejection, malformed job, or composition failure is reported as a state-local error; other independent
states continue. A failure to start the shared renderer or acquire the campaign lock remains a global failure.

Before a paid provider call, reserve one dispatch batch:

```sh
npm run image-campaign -- dispatch --campaign /absolute/path/campaign.json --provider runway \
  --output /private/runtime/runway-dispatch.json
```

This writes an open attempt to the campaign ledger before returning the provider-neutral dispatch document. An
unresolved attempt blocks a second dispatch, so an automation crash cannot accidentally repeat a paid generation.
After the browser operation returns provider ids, claim the exact attempt using a result document with the same
`attemptId`, `stateId`, and `requestDigest`. Runway results add two distinct `providerTaskIds`; ChatGPT results add
one `conversationUrl`. The claim updates both the job and ledger atomically enough to be safely replayed.

The ledger never stores browser headers, cookies, bearer tokens, signed asset URLs, or image bytes. Authentication is
captured from the live provider tab only for the duration of one remote batch. If that batch becomes uncertain, stop
and reconcile its named outputs in the provider session rather than reading Codex conversation traces or submitting
again.

If reconciliation proves that an open attempt was not submitted, or that an accepted provider task must be
quarantined after a policy correction, settle the exact attempt explicitly:

```sh
npm run image-campaign -- supersede --campaign /absolute/path/campaign.json \
  --provider runway --result /private/runtime/supersede-result.json
```

The result records each reserved state as `not-submitted`, `submitted-quarantined`, or `unknown`, along with any
known provider task ids. Only after every item is settled can a replacement dispatch be reserved. Quarantined task
ids remain in the audit ledger and are never imported as valid outputs.

A reserved ChatGPT dispatch can be served from one verified local process:

```sh
npm run chatgpt-image:serve -- \
  --campaign-dispatch /private/runtime/chatgpt-dispatch.json \
  --port 4321
```

`GET /campaign.json` lists the frozen states. Each state exposes only its exact prompt, request receipt, and indexed
attachments below `/states/<id>/...`. The server validates every request digest and attachment hash at startup, so
the browser automation can paste an entire campaign without restarting a server or opening Finder.
