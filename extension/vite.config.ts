import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Minimal explicit entries: panel page + background worker.
// Extraction functions live under src/capture and are imported by the
// background bundle so scripting.executeScript can invoke self-contained
// functions. No CDN runtime code.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: "panel.html",
        background: "src/background.ts",
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
  publicDir: "public",
});
