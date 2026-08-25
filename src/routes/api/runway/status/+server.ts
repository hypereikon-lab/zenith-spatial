import { json } from "@sveltejs/kit";
import { getRunwayStatus } from "$lib/server/runway/status";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = () => {
  return json(getRunwayStatus());
};
