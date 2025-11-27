import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Use standalone output for Electron packaging
  // This creates a minimal server that can be started from Electron
  output: "standalone"
};

export default nextConfig;
