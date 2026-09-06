import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  // Dev-only: bind all interfaces and accept tailnet hostnames, so the dev
  // server is reachable at http://<machine>.<tailnet>.ts.net:5173/.
  server: {
    host: true,
    allowedHosts: [".ts.net"],
  },
  plugins: [
    // WRANGLER_CONFIG selects the deployment config (default ./wrangler.jsonc);
    // the build bakes it in, so `npm run deploy:vapor.fyi` sets it for the
    // reference instance and a fork can point it at its own file.
    cloudflare({ viteEnvironment: { name: "ssr" }, configPath: process.env.WRANGLER_CONFIG }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
  ],
});
