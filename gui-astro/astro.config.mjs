import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: "0.0.0.0", port: Number(process.env.PORT ?? 3000) },
  devToolbar: { enabled: false },
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
