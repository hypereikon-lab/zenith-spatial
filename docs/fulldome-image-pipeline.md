# Fulldome image preparation

Zenith owns one narrow, deterministic stage between curated references and an external image model:

```text
curated pair or trio
  -> assign one source to the zenith slot
  -> arrange the remaining field sources
  -> inspect or edit in Compose
  -> render the exact metadata-bearing PNG
  -> send that PNG to GPT Image 2
```

The layout does not classify or describe image content. Curation supplies the semantic decision by naming the source
that belongs in the zenith slot. Zenith supplies projection-aware placement only.

## Workbench use

1. Select **Load curated bundle** and choose exactly two or three source images. This replaces only the editable Plate
   sources; existing commits and takes remain intact.
2. The final imported source is initially assigned to the zenith slot.
3. Under **Fulldome bundle**, change the **Zenith source** if necessary.
4. Choose the captured **Plate 03 profile** or its spatially mirrored form.
5. Select **Arrange fulldome bundle** after changing either assignment.
6. Inspect or refine the editable placements.
7. Select **Download exact PNG**.

The existing exact export remains authoritative. It renders at the selected carrier raster and embeds the complete
`zenith.plate.v1` draft and spatial contract without re-encoding the composed pixels afterward.

## Automation boundary

Import the narrow facade at `src/runtime/fulldome-image-pipeline.ts` rather than reproducing layout or export logic:

- `arrangeFulldomeBundle(...)` is the pure geometry operation.
- `prepareFulldomePlateBundle(...)` atomically replaces the editable sources and arranges a selected pair or trio.
- `arrangeFulldomePlateBundle(...)` applies it to the selected Workbench composition.
- `renderExactPlateDraftPng(...)` returns the exact PNG as a `Blob` instead of initiating a browser download.
- `prepareAndRenderFulldomePlateBundlePng(...)` performs import, layout, source decoding, and exact export as one
  Effect operation. It does not wait for React state and is the preferred automation entry point.

The renderer remains browser/WebGPU-owned. The caller supplies the existing preview session and receives the PNG
`Blob`; it can then download those bytes or pass them to the next authorized stage. The operation accepts ordinary
browser `File` values, so a Drive adapter only needs to materialize each selected binary with its original filename
and MIME type. Drive credentials and folder traversal remain outside Zenith.

## ChatGPT Images bridge

`scripts/chatgpt-image-bridge.mjs` supplies the narrow browser-protocol bridge needed while GPT Image 2.5 beta is
available through the authenticated ChatGPT product rather than a stable public API. It does not use mouse
coordinates, Finder, screenshots, or visual element discovery. It drives a dedicated Chrome tab through CDP and
uses stable DOM contracts:

1. Open ChatGPT Images with an already authenticated Chrome profile.
2. Preserve the prompt already present in the composer, or fill it from `promptFile`.
3. Assign the Plate Sketch alone so it is deterministically `Image1`.
4. Assign source and provenance files in manifest order.
5. Read the attachment names back from the DOM and refuse to continue on any mismatch.
6. With `--send`, submit once, wait for the completed generated image, and download the original response bytes.
7. Write a receipt next to the output with the exact prompt, hash, ordered inputs, conversation URL, and dimensions.

This is the programmatic equivalent of copy/paste: files are materialized directly as browser `File` objects in the
composer. The native file picker is never opened. Literal binary clipboard paste is intentionally not the contract;
browser clipboard image support varies by profile and permission state, while direct `FileList` assignment is
deterministic and preserves filenames and ordering.

Create a private job file from `docs/chatgpt-image-bridge.example.json`; do not commit local paths or sensitive data.
Then validate the operation without touching the browser:

```sh
npm run chatgpt-image -- --job /absolute/path/job.json --dry-run
```

Prepare and verify the composer without spending a generation:

```sh
npm run chatgpt-image -- --job /absolute/path/job.json
```

Submit, wait, download, and record provenance:

```sh
npm run chatgpt-image -- --job /absolute/path/job.json --send
```

If `promptFile` is omitted, the bridge requires a non-empty prompt already present in the composer and never edits
it. `expectedPromptSha256` can be added to the job for byte-level prompt verification. The bridge also refuses to
append onto a composer that already contains files, avoiding accidental cross-run contamination.

Pairs and trios intentionally share the same contract. A pair uses `zenith + field-primary`; a trio uses
`zenith + field-primary + field-secondary`. Mirroring changes spatial coordinates and rotation but never flips source
pixels.
