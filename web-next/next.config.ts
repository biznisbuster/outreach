import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/server-only moduli ne smeju u client bundle.
  serverExternalPackages: ["better-sqlite3", "imapflow", "nodemailer"],
};

export default nextConfig;
