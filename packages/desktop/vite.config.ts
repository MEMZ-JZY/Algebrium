import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath, URL } from "node:url"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      jsxgraph: fileURLToPath(new URL("./node_modules/jsxgraph/distrib/jsxgraphcore.mjs", import.meta.url)),
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    // Plotly and JSXGraph stay lazy; this limit applies to their isolated renderer chunks, not initial UI code.
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      onwarn(warning, warn) {
        // JSXGraph's prebuilt core contains its optional JessieCode evaluator; Algebrium only passes validated numeric geometry.
        if (warning.code === "EVAL" && warning.id?.includes("jsxgraphcore.mjs")) return
        warn(warning)
      },
    },
  },
  clearScreen: false,
})
