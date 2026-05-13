import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cloudflare Pages serves from the apex of pnake.sa2taka.com, so the
// default base of "/" is correct in every environment.
export default defineConfig({
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
