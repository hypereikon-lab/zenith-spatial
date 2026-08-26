import { Effect } from "effect";
import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";

import type { ZenithBrowserRuntime, ZenithBrowserServices } from "../runtime/browser-runtime.js";
import type { MediaRepositoryService } from "../runtime/media-repository.js";
import type { WorkbenchServiceShape } from "../runtime/workbench-service.js";

export type RuntimeContextValue = {
  readonly runtime: ZenithBrowserRuntime;
  readonly workbench: WorkbenchServiceShape;
  readonly media: MediaRepositoryService;
};

export const RuntimeContext = createContext<RuntimeContextValue | null>(null);

export function useRuntime(): RuntimeContextValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error("RuntimeProvider is missing.");
  return value;
}

export function useWorkbenchSnapshot() {
  const { workbench } = useRuntime();
  return useSyncExternalStore(workbench.subscribe, workbench.getSnapshot, workbench.getSnapshot);
}

export function useEffectRunner() {
  const { runtime } = useRuntime();
  const controllers = useRef(new Set<AbortController>());

  useEffect(
    () => () => {
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
    },
    [],
  );

  return useCallback(
    <A, E>(program: Effect.Effect<A, E, ZenithBrowserServices>): Promise<A> => {
      const controller = new AbortController();
      controllers.current.add(controller);
      return runtime.runPromise(program, { signal: controller.signal }).finally(() => {
        controllers.current.delete(controller);
      });
    },
    [runtime],
  );
}
