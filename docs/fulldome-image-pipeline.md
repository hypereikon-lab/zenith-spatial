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
and MIME type. Drive credentials, folder traversal, and GPT Image 2 submission remain outside Zenith.

Pairs and trios intentionally share the same contract. A pair uses `zenith + field-primary`; a trio uses
`zenith + field-primary + field-secondary`. Mirroring changes spatial coordinates and rotation but never flips source
pixels.
