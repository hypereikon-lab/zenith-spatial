export type ImagePixelDimensions = {
  width: number;
  height: number;
};

type ImageDimensionSource = {
  decoding: string;
  naturalWidth: number;
  naturalHeight: number;
  onload: ((event: Event) => unknown) | null;
  onerror: ((event: Event) => unknown) | null;
  src: string;
};

type CreateImageDimensionSource = () => ImageDimensionSource;

/** Decode the actual media bytes instead of trusting a filename or spatial label. */
export function readImagePixelDimensions(
  url: string,
  createImage: CreateImageDimensionSource = defaultImageDimensionSource,
): Promise<ImagePixelDimensions | null> {
  if (!url || (createImage === defaultImageDimensionSource && typeof Image === "undefined")) {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const image = createImage();
    image.decoding = "async";
    image.onload = () => {
      const width = Math.round(image.naturalWidth);
      const height = Math.round(image.naturalHeight);
      if (width <= 0 || height <= 0) {
        reject(new Error("Decoded image did not report positive pixel dimensions."));
        return;
      }
      resolve({ width, height });
    };
    image.onerror = () => reject(new Error("Could not decode image pixels for raster validation."));
    image.src = url;
  });
}

export async function assertExactImagePixelDimensions(
  url: string,
  expected: ImagePixelDimensions,
  label: string,
  createImage?: CreateImageDimensionSource,
): Promise<ImagePixelDimensions | null> {
  const actual = await readImagePixelDimensions(url, createImage);
  if (!actual) return null;
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw new Error(
      `${label} decoded as ${actual.width}×${actual.height}; the pinned carrier requires exactly ${expected.width}×${expected.height} pixels.`,
    );
  }
  return actual;
}

function defaultImageDimensionSource(): ImageDimensionSource {
  return new Image();
}
