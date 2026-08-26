import react from "@vitejs/plugin-react";
import typegpuPlugin from "unplugin-typegpu/vite";
import { defineConfig, type PluginOption } from "vite";

import hostingConfig from "./.openai/hosting.json" with { type: "json" };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

export default defineConfig(async ({ mode }) => {
  const siteMode = mode === "site";
  const plugins: PluginOption[] = [typegpuPlugin(), react()];
  if (siteMode) {
    const [{ cloudflare }, { sites }] = await Promise.all([
      import("@cloudflare/vite-plugin"),
      import("@openai/sites-vite-plugin"),
    ]);
    plugins.push(
      sites(),
      cloudflare({
        config: {
          name: "zenith-spatial",
          main: "./site-worker/index.ts",
          compatibility_date: "2026-05-22",
          compatibility_flags: ["nodejs_compat"],
          assets: {
            not_found_handling: "single-page-application",
            run_worker_first: ["/api/*"],
          },
          d1_databases: hostingConfig.d1
            ? [
                {
                  binding: hostingConfig.d1,
                  database_name: "zenith-sites-d1",
                  database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
                },
              ]
            : [],
          r2_buckets: hostingConfig.r2 ? [{ binding: hostingConfig.r2, bucket_name: "zenith-sites-r2" }] : [],
        },
      }),
    );
  }
  return {
    plugins,
    build: {
      outDir: siteMode ? "dist" : "dist/client",
      emptyOutDir: true,
    },
    server: siteMode
      ? { host: "127.0.0.1" }
      : {
          host: "127.0.0.1",
          proxy: {
            "/api": "http://127.0.0.1:4173",
          },
        },
  };
});
