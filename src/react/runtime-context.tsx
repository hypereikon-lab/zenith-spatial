import { Effect } from "effect";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { createBrowserManagedRuntime } from "../runtime/browser-runtime.js";
import { MediaRepository } from "../runtime/media-repository.js";
import { WorkbenchService } from "../runtime/workbench-service.js";
import { RuntimeContext, type RuntimeContextValue } from "./runtime-bridge.js";

export function RuntimeProvider({ children }: { readonly children: ReactNode }) {
  const [runtime] = useState(createBrowserManagedRuntime);
  const [services, setServices] = useState<Omit<RuntimeContextValue, "runtime"> | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    runtime
      .runPromise(
        Effect.all({
          workbench: WorkbenchService,
          media: MediaRepository,
        }),
      )
      .then((next) => {
        if (mounted) setServices(next);
      })
      .catch((error: unknown) => {
        if (mounted) setFailure(error instanceof Error ? error.message : "Zenith runtime failed to start.");
      });
    return () => {
      mounted = false;
      void runtime.dispose();
    };
  }, [runtime]);

  const value = useMemo(() => (services ? { runtime, ...services } : null), [runtime, services]);
  if (failure) {
    return (
      <main className="boot-screen" role="alert">
        <span className="boot-mark">Z</span>
        <h1>Runtime unavailable</h1>
        <p>{failure}</p>
      </main>
    );
  }
  if (!value) {
    return (
      <main className="boot-screen" aria-busy="true">
        <span className="boot-mark">Z</span>
        <p>Starting spatial workbench…</p>
      </main>
    );
  }
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}
