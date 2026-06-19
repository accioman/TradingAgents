import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("react-dom") || id.includes("react/")) return "react";
          if (id.includes("@tanstack") || id.includes("zustand")) return "query";
          if (id.includes("react-markdown") || id.includes("micromark") || id.includes("mdast")) return "markdown";
          if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) return "charts";
          if (id.includes("@xterm")) return "terminal";
          if (id.includes("lucide-react")) return "icons";
          return "vendor";
        }
      }
    }
  },
  server: {
    port: 5173,
    fs: {
      allow: [path.resolve(__dirname, "..")]
    }
  }
});
