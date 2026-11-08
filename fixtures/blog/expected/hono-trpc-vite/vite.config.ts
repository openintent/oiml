import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));
// In development the API runs separately (pnpm dev:api); Vite proxies tRPC calls to it.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:3111";

export default defineConfig({
  plugins: [
    // Must come before react(): it writes src/routeTree.gen.ts from the files in src/routes
    tanstackRouter({ target: "react", autoCodeSplitting: true, quoteStyle: "double" }),
    react(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      "@": `${root}src`,
      "@generated": `${root}generated`
    }
  },
  server: {
    proxy: { "/trpc": apiTarget, "/api": apiTarget }
  }
});
