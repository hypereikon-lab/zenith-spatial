import { describe, expect, test } from "vitest";

import { imageFilesFromClipboard, imageFilesFromList, type ClipboardImageData } from "./browser-image-files.js";

describe("browser image file intake", () => {
  test("keeps only image files from a file picker or drop", () => {
    const image = new File(["image"], "dome.png", { type: "image/png" });
    const text = new File(["text"], "notes.txt", { type: "text/plain" });
    expect(imageFilesFromList([image, text])).toEqual([image]);
  });

  test("uses clipboard files without duplicating their matching items", () => {
    const image = new File(["image"], "copied-dome.webp", { type: "image/webp" });
    const data: ClipboardImageData = {
      files: [image],
      items: [{ kind: "file", type: image.type, getAsFile: () => image }],
    };
    expect(imageFilesFromClipboard(data)).toEqual([image]);
  });

  test("extracts an image clipboard item and gives unnamed pixels a stable filename", () => {
    const unnamed = new File(["image"], "", { type: "" });
    const data: ClipboardImageData = {
      files: [],
      items: [
        { kind: "string", type: "text/plain", getAsFile: () => null },
        { kind: "file", type: "image/jpeg", getAsFile: () => unnamed },
      ],
    };
    const [result] = imageFilesFromClipboard(data, 1234);
    expect(result).toBeDefined();
    expect(result!.name).toBe("pasted-plate-1234-1.jpg");
    expect(result!.type).toBe("image/jpeg");
  });
});
