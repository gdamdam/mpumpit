import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` keeps all asset URLs relative so the AudioWorklets — which
// AudioPort loads via the relative path "./worklets/<name>.js" — resolve
// against the document base in both dev and the production build.
export default defineConfig({
  plugins: [react()],
  base: "./",
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    exclude: ["node_modules/**", "dist/**"],
  },
});
