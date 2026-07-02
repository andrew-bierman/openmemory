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

          if (id.includes("react-force-graph-2d")) {
            return "graph";
          }

          if (id.includes("recharts") || id.includes("d3-")) {
            return "charts";
          }

          return undefined;
        },
      },
    },
  },
  plugins: [tsconfigPaths(), tailwindcss(), tanstackStart(), react()],
});
