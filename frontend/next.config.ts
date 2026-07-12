import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["100.98.67.76", "continuum.sshogunn.org"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.BACKEND_INTERNAL_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
