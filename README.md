# Zenith

Zenith is a local spatial-image authoring instrument for fulldome and other immersive carriers. The product loop is deliberately narrow:

1. **Compose** ordered source images with projection-aware placement, warp, guides, and carrier preview.
2. **Commit Plate** to render the exact immutable Plate Sketch raster.
3. **Generate** from that exact commit, with explicit paid confirmation when Runway is configured, or import an Image Take locally.
4. **Review** a Plate Commit or Image Take as exact pixels or through its pinned spatial geometry.

**Add media** is the direct path around that Plate workflow: it imports an image as standalone Review media, opens its exact pixels immediately, and leaves Plate layers, commits, and generation state untouched. The imported bytes remain part of local and cloud `.zenith` saves and may still be inspected through the current carrier when a spatial preview is useful.

Every new browser workspace also includes **Demo · Forest Domemaster 180°**, the exact 1920 × 1920 equidistant domemaster under `public/demo-media`. It is selected as standalone media but does not enter the Plate Draft. Open Review to inspect it immediately as pixels or a dome, then use Immersive Preview for Phone Lookaround or compatible WebXR without generating or importing first. The public `/?demo=vr` link opens that same media in a focused mobile launcher without navigating through the Workbench.

The **physical horizon** is derived rather than freely authored: angular carriers use observer level at `0°`; CAVE, measured hall, and cylinder carriers use the projection observer's eye height above the venue floor. Compose keeps that guide visible and edits the measured observer height directly. A non-zero deviation is available only as an explicit advanced installation calibration. **Align image horizon** is a separate Plate-map control that changes where image pixels are allocated around the physical guide and compensates Plate placement through physical space.

Compose and Review include an **Audience in Space** view: a perspective POV from a movable person whose X/Z position, eye height, facing, and field of view are expressed in meters. Measured rooms use their authored dimensions; angular carriers receive a workspace-only physical dome radius. Audience movement is inspection state and never changes Plate placement or projection mapping.

Review also exposes **Immersive Preview** from the same pinned spatial specification. Phone Lookaround uses orientation sensors when permission is available and keeps touch drag as a universal fallback. Compatible WebXR headsets enter the carrier at 1:1 scale from the authored audience X/Z/facing; the physical headset supplies head height and local movement. Compatible AR devices place a bounded carrier scale model using hit testing. XR poses, placement candidates, frame loops, and controller state are runtime-only and are never written into the project.

Zenith supports multiple independent Compositions, but it is not a timeline, NLE, generic workflow engine, dashboard, or deployment platform.

## Architecture

- **Effect 3** owns services, Layers, the single browser `ManagedRuntime`, typed errors, observable `SubscriptionRef` state, scoped media handles, job Streams/fibers, cancellation, configuration, clocks, and IDs.
- **React 19 + Vite** render the workstation. React subscribes through `useSyncExternalStore`, dispatches Effect programs, owns canvas/pointer wiring, and keeps only interaction-local UI state.
- **Effect Schema** defines the portable project, composition, media, commit, take, generation, carrier, and API boundaries.
- **Effect Platform Node** serves the production client and the generation API. Secrets, paid validation, confirmation grants, provider calls, durable job state, cancellation, and outputs remain server-side.
- The optional **ChatGPT Site Worker** runs the same React workbench with an Effect 3 request boundary. ChatGPT identity scopes a D1 project index and exact `.zenith` archives in R2; optimistic revisions prevent accidental cross-device overwrites.
- **Pure TypeScript + TypeGPU/WGSL** retain geometry, projection transforms, plate composition, guide kernels, shader parity, and deterministic reducers without Effect wrappers.
- A scoped **WebXR + WebGL 2 presentation adapter** reuses the portable carrier mesh and projection UV contracts. It is loaded only when Immersive Preview starts; the primary workstation renderer remains TypeGPU/WebGPU.

The main source boundaries are:

| Area                          | Responsibility                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/domain`                  | Portable `Project`, `Composition`, `MediaAsset`, `PlateCommit`, `ImageTake`, `Workspace`, and job schemas/transitions/selectors |
| `src/runtime`                 | Browser Layers, state bridge, media ownership, generation commands, and project persistence                                     |
| `src/react`                   | DCC-style shell and Compose, Generate, and Review rooms                                                                         |
| `src/geometry`, `src/kernels` | Pure carrier math and CPU/WGSL parity                                                                                           |
| `src/plates`, `src/graphics`  | Plate placement/composition and scoped WebGPU previews                                                                          |
| `src/media`                   | Image normalization, PNG provenance, downloads, and archive container                                                           |
| `src/inpaint`                 | Projection-aware generation prompt compiler; inpaint is a strategy, not an application room                                     |
| `server`                      | Effect Platform Node API, paid confirmation, jobs, provider boundary, persistence, and static serving                           |
| `site-worker`, `drizzle`      | Sites identity boundary, D1 project revisions, R2 archive storage, and its SQL migration                                        |

See [projection carriers](docs/projection-carriers.md) for the carrier and rendering contracts.

## Domain and persistence

A Composition owns ordered source assets, one editable Plate Draft, immutable Plate Commits, standalone Review media, Image Takes, and its current selections. Readiness, dirty, and stale states are derived from commit fingerprints and parent relationships; they are not persisted flags. Portable assets store descriptors and stable storage references only—never `Blob`, `File`, canvas, or object URLs.

Project files are binary `.zenith` archives containing the schema-validated document plus exact media sidecars. Loading replaces runtime media atomically and restores the workspace. The loader also includes a one-way importer for the former schema-version 17 JSON/archive format; new saves always use the current domain.

Plate Draft and Plate Commit PNGs carry a `zenith.plate.v1` `iTXt` payload with their exact draft, carrier geometry, spatial specification, derived physical horizon, optional calibration, image-horizon alignment, stable project/composition identity, and commit provenance. Importing one can restore the pinned authoring geometry independently of the currently selected carrier. Generated Image Takes retain the pinned generation contract in `zenith.spatial.v1`. Metadata chunks are inserted without re-encoding image pixels. General-purpose image editors may strip ancillary PNG chunks, so a `.zenith` archive remains the authoritative complete project format.

## Local development

Requires Node.js 22 or newer and a browser with WebGPU.

```sh
npm ci
npm run dev
```

Development starts the Effect server at `http://127.0.0.1:4173` and Vite at `http://127.0.0.1:5173`. Vite proxies `/api` to the Effect server.

Production-style local serving:

```sh
npm run build
npm start
```

### Phones and headsets

Immersive modes are capability-detected rather than inferred from a user-agent string:

- Every supported browser gets Phone Lookaround; orientation permission augments the touch view when available.
- Meta Quest and other compatible headsets get `immersive-vr` at physical scale.
- Browsers exposing `immersive-ar` get a hit-tested AR scale model. Current iPhone/iPad Safari remains on Phone Lookaround because it does not expose the same immersive AR session.

WebXR and mobile orientation access require a secure context. `localhost` is sufficient on the same computer, but another device needs a hostname and certificate it trusts. Zenith can serve its production build over optional local TLS without a cloud deployment:

```sh
npm run build
ZENITH_HOST=0.0.0.0 \
ZENITH_TLS_CERT_PATH=/absolute/path/to/zenith-local.pem \
ZENITH_TLS_KEY_PATH=/absolute/path/to/zenith-local-key.pem \
npm start
```

Open the resulting trusted `https://<local-hostname>:4173` URL on the phone or headset. Generate the certificate for the actual LAN hostname with a local CA such as `mkcert`, trust that CA on the target device, and never commit certificate private keys. An untrusted self-signed warning does not provide a dependable WebXR secure context.

By default, `npm start` serves `dist/client` and the API together at `http://127.0.0.1:4173`; configuring both TLS paths switches that server to HTTPS.

Checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

## ChatGPT Site

The Site is a second delivery mode for the same Vite/React workstation, not a fork of the product. It keeps Compose, direct Add media review, exact Plate Commit/download, imported Image Takes, spatial Review, Audience in Space, Phone Lookaround, and capability-detected WebXR. After ChatGPT sign-in, **Site** in the header can save, load, revision, and delete private projects. Each remote revision is the normal binary `.zenith` archive, so media bytes and multi-composition integrity are identical to local Save/Open.

```sh
npm ci
npm run dev:site
```

The local Sites adapter runs at `http://127.0.0.1:5173` and provides a local test sign-in. A production Site is HTTPS, which supplies the secure context required by supported orientation and WebXR modes; its public or shared access policy is managed by Sites rather than source code.

Build and package checks:

```sh
npm run build:site
npm run preview:site
```

Paid Runway generation intentionally remains disabled in Site mode. The local Effect Platform Node mode retains the complete paid confirmation, input-digest, progress, cancellation, output, and recovery contract. The Worker must not claim hosted generation is configured until it has an equally durable job journal; local and imported Image Takes remain fully reviewable on the Site.

## Server configuration

Copy `.env.example` to `.env.local` for local configuration. The server scripts load it directly; Vite never receives the Runway secret. Do not commit either file with real credentials.

- `RUNWAYML_API_SECRET`: enables paid generation. Without it, Generate stays visibly disabled while local imports remain available.
- `RUNWAY_API_BASE`, `RUNWAY_API_VERSION`: optional provider overrides.
- `RUNWAY_POLL_INTERVAL_MS`, `RUNWAY_POLL_TIMEOUT_MS`: optional polling controls.
- `ZENITH_HOST`, `ZENITH_PORT`: local bind address (defaults `127.0.0.1:4173`).
- `ZENITH_RUNTIME_DIR`: durable job journal and output directory (defaults `.zenith-runtime`).
- `ZENITH_CLIENT_DIR`: built client directory (defaults `dist/client`).
- `ZENITH_TLS_CERT_PATH`, `ZENITH_TLS_KEY_PATH`: optional local HTTPS certificate and private-key paths; configure both or neither.

Every paid action requires a short-lived, one-use confirmation grant bound to the project and an input digest. The server validates the request and exact raster before invoking the provider. Tests use test Layers and never perform paid calls.

## Current limits

- Spatial projection review requires WebGPU; exact-pixel review remains available independently.
- Immersive Preview requires WebGL 2. VR/AR buttons appear only after successful WebXR capability detection; hardware acceptance still requires the target phone or headset.
- iOS/iPadOS currently receive Phone Lookaround rather than `immersive-ar`; no polyfill can supply a session the browser withholds.
- Venue geometry is not yet a projector-by-projector calibration/export system.
- Runway is the only paid provider implementation, behind a replaceable Effect service boundary.
