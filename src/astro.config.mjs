import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// SITE and BASE_PATH are set by the deploy workflow (from actions/configure-pages),
// so the same config works for user sites and project sites (/<repo>/).
export default defineConfig({
  site: process.env.SITE || undefined,
  base: process.env.BASE_PATH || "/",
  trailingSlash: "ignore",
  compressHTML: true,
  build: {
    inlineStylesheets: "always",
    assets: "assets",
  },
  vite: {
    plugins: [tailwindcss()],
    build: {
      // Inline the page script instead of emitting a separate .js file
      assetsInlineLimit: 100_000,
    },
  },
});
