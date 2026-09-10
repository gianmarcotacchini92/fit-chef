import type { NextConfig } from "next";
import path from "node:path";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "/fit-chef";
if (basePath && !/^(?:\/[A-Za-z0-9_-]+)+$/.test(basePath)) {
  throw new Error("NEXT_PUBLIC_BASE_PATH deve essere vuoto oppure un percorso come /fit-chef, senza slash finale.");
}

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_FIT_STATIC: "true",
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  turbopack: { root: path.resolve(__dirname, "..") },
};

export default nextConfig;
