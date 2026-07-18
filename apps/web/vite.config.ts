import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 54152,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }

          if (id.includes("/@tanstack/")) {
            return "tanstack-vendor";
          }

          if (id.includes("/recharts/")) {
            return "charts-vendor";
          }

          if (id.includes("/d3-")) {
            return "d3-vendor";
          }

          if (
            id.includes("/react-force-graph-2d/") ||
            id.includes("/force-graph/") ||
            id.includes("/kapsule/") ||
            id.includes("/lodash-es/")
          ) {
            return "graph-vendor";
          }

          return undefined;
        },
      },
    },
  },
  plugins: [tsconfigPaths(), tailwindcss(), tanstackStart(), react()],
});
