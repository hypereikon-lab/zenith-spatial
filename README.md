# Zenith

Zenith is a local spatial-image authoring instrument for fulldome and other immersive carriers. The product loop is deliberately narrow:

1. **Compose** ordered source images with projection-aware placement, warp, guides, and carrier preview.
2. **Commit Plate** to render the exact immutable Plate Sketch raster.
3. **Generate** from that exact commit, with explicit paid confirmation when Runway is configured, or import an Image Take locally.
4. **Review** a Plate Commit or Image Take as exact pixels or through its pinned spatial geometry.

Zenith supports multiple independent Compositions, but it is not a timeline, NLE, generic workflow engine, dashboard, or deployment platform.

## Architecture

- **Effect 3** owns services, Layers, the single browser `ManagedRuntime`, typed errors, observable `SubscriptionRef` state, scoped media handles, job Streams/fibers, cancellation, configuration, clocks, and IDs.
- **React 19 + Vite** render the workstation. React subscribes through `useSyncExternalStore`, dispatches Effect programs, owns canvas/pointer wiring, and keeps only interaction-local UI state.
- **Effect Schema** defines the portable project, composition, media, commit, take, generation, carrier, and API boundaries.
- **Effect Platform Node** serves the production client and the generation API. Secrets, paid validation, confirmation grants, provider calls, durable job state, cancellation, and outputs remain server-side.
- **Pure TypeScript + TypeGPU/WGSL** retain geometry, projection transforms, plate composition, guide kernels, shader parity, and deterministic reducers without Effect wrappers.

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

See [projection carriers](docs/projection-carriers.md) for the carrier and rendering contracts.

## Domain and persistence

A Composition owns ordered source assets, one editable Plate Draft, immutable Plate Commits, Image Takes, and its current selections. Readiness, dirty, and stale states are derived from commit fingerprints and parent relationships; they are not persisted flags. Portable assets store descriptors and stable storage references only—never `Blob`, `File`, canvas, or object URLs.

Project files are binary `.zenith` archives containing the schema-validated document plus exact media sidecars. Loading replaces runtime media atomically and restores the workspace. The loader also includes a one-way importer for the former schema-version 17 JSON/archive format; new saves always use the current domain.

Generated PNG outputs retain the pinned spatial contract in an uncompressed `zenith.spatial.v1` `iTXt` chunk without re-encoding image pixels.

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

`npm start` serves `dist/client` and the API together at `http://127.0.0.1:4173`.

Checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

## Server configuration

Copy `.env.example` to `.env.local` for local configuration. The server scripts load it directly; Vite never receives the Runway secret. Do not commit either file with real credentials.

- `RUNWAYML_API_SECRET`: enables paid generation. Without it, Generate stays visibly disabled while local imports remain available.
- `RUNWAY_API_BASE`, `RUNWAY_API_VERSION`: optional provider overrides.
- `RUNWAY_POLL_INTERVAL_MS`, `RUNWAY_POLL_TIMEOUT_MS`: optional polling controls.
- `ZENITH_HOST`, `ZENITH_PORT`: local bind address (defaults `127.0.0.1:4173`).
- `ZENITH_RUNTIME_DIR`: durable job journal and output directory (defaults `.zenith-runtime`).
- `ZENITH_CLIENT_DIR`: built client directory (defaults `dist/client`).

Every paid action requires a short-lived, one-use confirmation grant bound to the project and an input digest. The server validates the request and exact raster before invoking the provider. Tests use test Layers and never perform paid calls.

## Current limits

- Spatial projection review requires WebGPU; exact-pixel review remains available independently.
- Venue geometry is not yet a projector-by-projector calibration/export system.
- Runway is the only paid provider implementation, behind a replaceable Effect service boundary.
