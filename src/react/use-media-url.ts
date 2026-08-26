import { useEffect, useState } from "react";

import type { MediaAsset } from "../domain/schema.js";
import { useEffectRunner, useRuntime } from "./runtime-bridge.js";

export function useMediaUrl(asset: MediaAsset | null | undefined): string | null {
  const { media } = useRuntime();
  const run = useEffectRunner();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setUrl(null);
    if (!asset)
      return () => {
        active = false;
      };
    void run(media.resolveUrl(asset))
      .then((next) => {
        if (active) setUrl(next);
      })
      .catch(() => {
        if (active) setUrl(null);
      });
    return () => {
      active = false;
    };
  }, [asset?.id, asset?.storageRef, media, run]);

  return url;
}
