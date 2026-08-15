import type { MetadataRoute } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Manifest colors match the theme-color script in app/layout.tsx
// (light: hsl(0 0% 100%) / dark: hsl(240deg 10% 3.92%)).
const LIGHT_THEME_COLOR = "#ffffff";
const DARK_THEME_COLOR = "#09090b";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI Chat",
    short_name: "AI Chat",
    description: "AI chat frontend built with Next.js and the AI SDK.",
    start_url: `${basePath}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: DARK_THEME_COLOR,
    theme_color: LIGHT_THEME_COLOR,
    icons: [
      {
        src: `${basePath}/icons/icon-192.png`,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: `${basePath}/icons/icon-512.png`,
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: `${basePath}/icons/maskable-512.png`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
