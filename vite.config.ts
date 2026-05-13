import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages serves under https://sa2taka.github.io/pnake/, so all
// asset URLs need the /pnake/ prefix. Local dev still serves at /.
// We switch via the BUILD_FOR_PAGES env so `pnpm preview` (which is what
// Playwright uses) keeps working without a prefix.
const BASE = process.env.BUILD_FOR_PAGES ? "/pnake/" : "/";

export default defineConfig({
  base: BASE,
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
  },
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
