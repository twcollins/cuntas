import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Native builds (Capacitor) serve files from the app bundle, so they skip the service worker.
const native = process.env.CAPACITOR === "1";

export default defineConfig({
  plugins: [
    react(),
    !native && VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Cúntas",
        short_name: "Cúntas",
        description: "Privacy-first budgeting and planning with Irish and UK tax rules.",
        theme_color: "#0f766e",
        background_color: "#f8faf9",
        display: "standalone",
        start_url: "/",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
        // Installed on a desktop, "Open with Cúntas" sends statements, rule files and backups to the right page.
        file_handlers: [
          {
            action: "/",
            accept: {
              "text/csv": [".csv"],
              "application/x-ofx": [".ofx", ".qfx"],
              "application/xml": [".xml"],
              "application/yaml": [".yaml", ".yml"],
              "application/json": [".json"],
              "application/octet-stream": [".cuntas"],
            },
          },
        ],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg}"], navigateFallback: "/index.html" },
    }),
  ],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1500 },
});
