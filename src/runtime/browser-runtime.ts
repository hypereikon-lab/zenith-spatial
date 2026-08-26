import { BrowserHttpClient } from "@effect/platform-browser";
import { Layer, ManagedRuntime } from "effect";

import { IdGenerator } from "./id-service.js";
import { MediaRepository } from "./media-repository.js";
import { GenerationClient } from "./generation-client.js";
import { WorkbenchService } from "./workbench-service.js";
import { ImmersivePreview } from "../xr/immersive-preview-service.js";

const WorkbenchLive = WorkbenchService.Live.pipe(Layer.provide(IdGenerator.Live));

const BrowserInfrastructure = Layer.mergeAll(
  BrowserHttpClient.layerXMLHttpRequest,
  IdGenerator.Live,
  MediaRepository.Live,
  ImmersivePreview.Live,
  WorkbenchLive,
);

export const BrowserApplicationLayer = GenerationClient.Live.pipe(Layer.provideMerge(BrowserInfrastructure));

export function createBrowserManagedRuntime() {
  return ManagedRuntime.make(BrowserApplicationLayer);
}

export type ZenithBrowserRuntime = ReturnType<typeof createBrowserManagedRuntime>;
export type ZenithBrowserServices = ManagedRuntime.ManagedRuntime.Context<ZenithBrowserRuntime>;
