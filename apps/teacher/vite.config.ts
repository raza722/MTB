import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    // Must come before the React plugin so file routes are generated first.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  server: {
    port: 5174,
    strictPort: true,
    // The apps call /api/<path>; the backend serves /api/v1/<path> (backend/docs/INTEGRATION_CONVENTIONS.md §1).
    // MSW still answers the modules that are not built yet and lets the rest through to here. The sign-in cookie
    // (mtb_session, Path=/, no Domain) passes through, so the browser keeps it for this dev origin.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8100",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/api/v1"),
        // Keep the cookie on this origin even if the backend ever names a Domain (127.0.0.1 is not localhost).
        cookieDomainRewrite: { "*": "" },
      },
    },
  },
});
