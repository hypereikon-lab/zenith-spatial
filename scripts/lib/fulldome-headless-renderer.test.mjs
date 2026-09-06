import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { normalizeFulldomeComposeJob } from "./fulldome-headless-renderer.mjs";

describe("fulldome compose job provenance", () => {
  test("derives direct plate references from the finalized generation receipt", () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-compose-receipt-"));
    const outputA = write(root, "generated-a.png", "OUTPUT-A");
    const outputB = write(root, "generated-b.png", "OUTPUT-B");
    const sourceB = write(root, "drive-leaf.png", "DRIVE-LEAF");
    const reference = write(root, "atlas-reference.jpg", "REFERENCE");
    const receipt = join(root, "runway-generation.json");
    writeFileSync(
      receipt,
      JSON.stringify({
        schema: "zenith.runway-image-generation.v1",
        references: [{ source: reference, sha256: digest(reference) }],
        outputs: [
          { source: outputA, sha256: digest(outputA) },
          { source: outputB, sha256: digest(outputB) },
        ],
      }),
    );

    const job = normalizeFulldomeComposeJob({
      sources: [{ path: outputA, generationReceipt: receipt }, { path: sourceB }],
    });

    expect(job.sources[0]).toMatchObject({
      path: outputA,
      directReferences: [{ path: reference }],
      generationReceipt: { path: receipt },
    });
    expect(job.sources[1]).toMatchObject({ path: sourceB, directReferences: [], generationReceipt: null });
  });

  test("rejects a receipt that did not produce the selected plate source", () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-compose-receipt-mismatch-"));
    const selected = write(root, "selected.png", "SELECTED");
    const other = write(root, "other.png", "OTHER");
    const leaf = write(root, "leaf.png", "LEAF");
    const reference = write(root, "reference.jpg", "REFERENCE");
    const receipt = join(root, "runway-generation.json");
    writeFileSync(
      receipt,
      JSON.stringify({
        schema: "zenith.runway-image-generation.v1",
        references: [{ source: reference, sha256: digest(reference) }],
        outputs: [{ source: other, sha256: digest(other) }],
      }),
    );

    expect(() =>
      normalizeFulldomeComposeJob({ sources: [{ path: selected, generationReceipt: receipt }, { path: leaf }] }),
    ).toThrow(/did not produce/);
  });

  test("normalization is idempotent across the CLI and warm API boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "zenith-compose-idempotent-"));
    const output = write(root, "generated.png", "OUTPUT");
    const leaf = write(root, "leaf.png", "LEAF");
    const reference = write(root, "reference.jpg", "REFERENCE");
    const receipt = join(root, "runway-generation.json");
    writeFileSync(
      receipt,
      JSON.stringify({
        schema: "zenith.runway-image-generation.v1",
        references: [{ source: reference, sha256: digest(reference) }],
        outputs: [{ source: output, sha256: digest(output) }],
      }),
    );

    const first = normalizeFulldomeComposeJob({
      sources: [{ path: output, generationReceipt: receipt }, { path: leaf }],
    });
    const second = normalizeFulldomeComposeJob(first);

    expect(second.sources[0].generationReceipt).toEqual({ path: receipt });
    expect(second.sources[0].directReferences).toEqual([{ path: reference }]);
  });
});

function write(root, filename, contents) {
  const path = join(root, filename);
  writeFileSync(path, contents);
  return path;
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
