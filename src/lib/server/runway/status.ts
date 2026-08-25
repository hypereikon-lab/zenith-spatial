import { API_BASE, API_VERSION, getRunwayApiKey, INPAINT_MODEL } from "./config";

export function getRunwayStatus() {
  return {
    configured: Boolean(getRunwayApiKey()),
    apiBase: API_BASE,
    apiVersion: API_VERSION,
    models: { inpaint: INPAINT_MODEL },
  };
}
