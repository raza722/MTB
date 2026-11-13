import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev-server overrides for running a second stack beside the usual one (e.g. API 8101, app 5176):
//   MTB_API_TARGET  the backend origin the /api proxy forwards to (default http://127.0.0.1:8100)
//   MTB_DEV_PORT    this app's port (default 5175)      MTB_DEV_HOST  the address to bind (default: Vite's, localhost)
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig({
  plugins: [
    // Must come before the React plugin so file routes are generated first.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  server: {
    port: Number(env.MTB_DEV_PORT ?? 5175),
    strictPort: true,
    host: env.MTB_DEV_HOST,
    // The apps call /api/<path>; the backend serves /api/v1/<path> (backend/docs/INTEGRATION_CONVENTIONS.md §1).
    // MSW still answers the modules that are not built yet and lets the rest through to here. The sign-in cookie
    // (mtb_session, Path=/, no Domain) passes through, so the browser keeps it for this dev origin.
    proxy: {
      "/api": {
        target: env.MTB_API_TARGET ?? "http://127.0.0.1:8100",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, "/api/v1"),
        // Keep the cookie on this origin even if the backend ever names a Domain (127.0.0.1 is not localhost).
        cookieDomainRewrite: { "*": "" },
        // Spec 12 fix R2: the portal limits code requests per client address. Overwrite X-Forwarded-For with the
        // address this proxy saw (never the browser's own header, which anyone can set), so the backend, which trusts
        // this proxy (FORWARDED_ALLOW_IPS), counts each device and not the proxy as one shared address.
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq, req) => {
            proxyReq.setHeader("x-forwarded-for", req.socket.remoteAddress ?? "");
          });
        },
      },
    },
  },
});
