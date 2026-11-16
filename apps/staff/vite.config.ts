import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// Server settings, strongest first: the shell's environment, this app's .env.local / .env, then mtb/.env.local / .env
// (shared by all three apps; *.local files stay on this computer):
//   MTB_API_TARGET    the backend origin the /api proxy forwards to (default http://127.0.0.1:8100)
//   MTB_DEV_HOST      the address to bind: 0.0.0.0 serves the app to the network (default: Vite's, localhost only)
//   MTB_DEV_PORT      this app's dev port (default 5173)    MTB_PREVIEW_PORT  the built app's port (default 4173)
const dir = (rel: string) => decodeURIComponent(new URL(rel, import.meta.url).pathname).replace(/^\/(?=[A-Za-z]:)/, "");
const shell = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

export default defineConfig(({ mode }) => {
  const env: Record<string, string | undefined> = { ...loadEnv(mode, dir("../../"), "MTB_"), ...loadEnv(mode, dir("./"), "MTB_"), ...shell };
  const target = env.MTB_API_TARGET ?? "http://127.0.0.1:8100";
  return {
    plugins: [
      // Must come before the React plugin so file routes are generated first.
      tanstackRouter({ target: "react", autoCodeSplitting: true }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
    ],
    server: {
      port: Number(env.MTB_DEV_PORT ?? 5173),
      strictPort: true,
      host: env.MTB_DEV_HOST,
      // The apps call /api/<path>; the backend serves /api/v1/<path> (backend/docs/INTEGRATION_CONVENTIONS.md §1).
      // MSW still answers the modules that are not built yet and lets the rest through to here. The sign-in cookie
      // (mtb_session, Path=/, no Domain) passes through, so the browser keeps it for this dev origin.
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, "/api/v1"),
          // Keep the cookie on this origin even if the backend ever names a Domain (127.0.0.1 is not localhost).
          cookieDomainRewrite: { "*": "" },
          // The backend's CSRF check trusts only the Origins it knows (localhost dev ports and its own address), so a page
          // opened by network address (http://172.16.1.68:5173) is refused with CSRF_REJECTED. A request from this app's
          // own pages (Origin = the address the browser opened) goes on with the backend's own origin; a request from any
          // other site keeps its Origin and is still refused.
          configure: (proxy) => {
            proxy.on("proxyReq", (proxyReq, req) => {
              if (req.headers.origin && req.headers.origin === `http://${req.headers.host}`) proxyReq.setHeader("origin", new URL(target).origin);
            });
          },
        },
      },
    },
    // The built app (`pnpm preview:all`): staff 4173, teacher 4174, portal 4175. Host and /api proxy follow `server`.
    preview: {
      port: Number(env.MTB_PREVIEW_PORT ?? 4173),
      strictPort: true,
    },
  };
});
