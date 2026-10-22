import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
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
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg}"], navigateFallback: "/index.html" },
    }),
  ],
  server: { port: 5173 },
  build: { chunkSizeWarningLimit: 1500 },
});
