import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8"));

// `base: "./"` keeps all asset URLs relative so the AudioWorklets — which
// AudioPort loads via the relative path "./worklets/<name>.js" — resolve
// against the document base in both dev and the production build.
export default defineConfig({
  plugins: [react()],
  base: "./",
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
