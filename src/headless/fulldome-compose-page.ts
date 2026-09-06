import { Effect } from "effect";

import {
  composeFulldomePlateBundlePng,
  type FulldomeComposeManifest,
  type FulldomeComposeOptions,
  type FulldomeDirectReference,
} from "../runtime/fulldome-compose-kernel.js";
import { createPlateSketchPreviewSession } from "../plates/plate-sketch-preview-session.js";

type BrowserComposeOptions = FulldomeComposeOptions & {
  readonly sourceLocatorsBySource?: ReadonlyArray<string>;
  readonly directReferencesBySource?: ReadonlyArray<ReadonlyArray<FulldomeDirectReference>>;
  readonly generationReceiptsBySource?: ReadonlyArray<FulldomeDirectReference | null>;
};

declare global {
  interface Window {
    zenithFulldomeComposeReady: boolean;
    zenithFulldomeCompose: (options?: BrowserComposeOptions) => Promise<{
      readonly filename: string;
      readonly width: number;
      readonly height: number;
      readonly manifest: FulldomeComposeManifest;
    }>;
  }
}

const input = requiredElement<HTMLInputElement>("zenith-fulldome-sources");
const download = requiredElement<HTMLAnchorElement>("zenith-fulldome-download");
const renderCanvas = document.createElement("canvas");
const session = createPlateSketchPreviewSession(renderCanvas);
let outputUrl: string | null = null;

window.zenithFulldomeComposeReady = true;
window.zenithFulldomeCompose = async (options = {}) => {
  const files = Array.from(input.files ?? []);
  const sources = files.map((file, index) => ({
    file,
    source: options.sourceLocatorsBySource?.[index],
    directReferences: options.directReferencesBySource?.[index] ?? [],
    generationReceipt: options.generationReceiptsBySource?.[index] ?? undefined,
  }));
  const result = await Effect.runPromise(composeFulldomePlateBundlePng(session, sources, options));

  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = URL.createObjectURL(result.blob);
  download.href = outputUrl;
  download.download = result.filename;
  return {
    filename: result.filename,
    width: result.width,
    height: result.height,
    manifest: result.manifest,
  };
};

window.addEventListener("beforeunload", () => {
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  session.destroy();
});

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Headless fulldome harness is missing #${id}.`);
  return element as T;
}
