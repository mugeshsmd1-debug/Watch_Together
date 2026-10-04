/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // Prevents duplicate WebRTC connection initialization in dev
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
