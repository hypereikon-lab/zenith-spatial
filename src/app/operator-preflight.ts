import { workbench } from "../artifacts/artifact-store.svelte.js";
import { requestRunwayStatus } from "../runway/client.js";

export function refreshBrowserOperatorEnvironment(): void {
  const browser = typeof document !== "undefined" && typeof navigator !== "undefined";
  workbench.operatorEnvironment.browser = browser;
  workbench.operatorEnvironment.webgpu = browser && Boolean(navigator.gpu);
}

export async function refreshOperatorPreflightStatus(): Promise<void> {
  refreshBrowserOperatorEnvironment();
  try {
    const status = await requestRunwayStatus();
    workbench.operatorEnvironment.runwayConfigured =
      typeof status === "object" && status !== null && "configured" in status
        ? Boolean((status as { configured?: unknown }).configured) : null;
  } catch {
    workbench.operatorEnvironment.runwayConfigured = null;
  }
  workbench.operatorEnvironment.checkedAt = new Date().toISOString();
}
