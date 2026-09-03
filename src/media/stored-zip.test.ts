import { describe, expect, test } from "vitest";

import { createStoredZip } from "./stored-zip.js";

describe("stored ZIP", () => {
  test("packages UTF-8 named entries with local, central, and end records", async () => {
    const archive = await createStoredZip([
      { name: "tiles/01-front.png", data: new Uint8Array([1, 2, 3]) },
      { name: "manifest.json", data: '{"ok":true}' },
    ]);
    const bytes = new Uint8Array(await archive.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const view = new DataView(bytes.buffer);

    expect(archive.type).toBe("application/zip");
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 14, true)).toBe(2);
    expect(text).toContain("tiles/01-front.png");
    expect(text).toContain("manifest.json");
  });
});
