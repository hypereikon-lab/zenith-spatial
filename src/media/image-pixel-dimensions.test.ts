import { describe, expect, test } from "vitest";
import { assertExactImagePixelDimensions, readImagePixelDimensions } from "./image-pixel-dimensions.js";

describe("image pixel dimensions", () => {
  test("reads decoded dimensions from the media bytes", async () => {
    await expect(readImagePixelDimensions("data:image/png;base64,test", fakeImage(2912, 1248))).resolves.toEqual({
      width: 2912,
      height: 1248,
    });
  });

  test("rejects an output whose decoded raster differs from the pinned carrier", async () => {
    await expect(
      assertExactImagePixelDimensions(
        "data:image/png;base64,test",
        { width: 2912, height: 1248 },
        "Generated result",
        fakeImage(1456, 624),
      ),
    ).rejects.toThrow("Generated result decoded as 1456×624; the pinned carrier requires exactly 2912×1248 pixels");
  });

  test("does not pretend to validate pixels outside a browser decoder", async () => {
    await expect(readImagePixelDimensions("data:image/png;base64,test")).resolves.toBeNull();
  });
});

function fakeImage(width: number, height: number) {
  return () => {
    let onload: ((event: Event) => unknown) | null = null;
    let onerror: ((event: Event) => unknown) | null = null;
    return {
      decoding: "auto",
      naturalWidth: width,
      naturalHeight: height,
      get onload() {
        return onload;
      },
      set onload(value) {
        onload = value;
      },
      get onerror() {
        return onerror;
      },
      set onerror(value) {
        onerror = value;
      },
      get src() {
        return "";
      },
      set src(_value: string) {
        onload?.(new Event("load"));
      },
    };
  };
}
