import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";
import typegpuPlugin from "unplugin-typegpu/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [typegpuPlugin(), tailwindcss(), sveltekit()],
});
