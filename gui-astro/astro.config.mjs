import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) },
  devToolbar: { enabled: false },
  // Iza Nginx reverse proxy-ja: Astro Node adapter računa url.origin iz
  // Host header-a kao `http://...` jer ne koristi X-Forwarded-Proto po
  // defaultu. Browser šalje Origin: `https://...` → "Cross-site POST
  // form submissions are forbidden". Astro preporučuje checkOrigin: false
  // za reverse proxy setup (mi imamo HMAC-signed cookies, single-user,
  // pa je CSRF check iz Astro manje kritičan).
  security: {
    checkOrigin: false,
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "~": path.resolve("./src"),
        "@": path.resolve("./src"),
      },
    },
    optimizeDeps: { exclude: ["better-sqlite3"] },
    ssr: { external: ["better-sqlite3", "imapflow", "nodemailer"] },
  },
});
