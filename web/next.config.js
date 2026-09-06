/** @type {import('next').NextConfig} */
const nextConfig = {
  // This repo also has an Electron app with its own package-lock.json at
  // the root; pin Turbopack's root here so it doesn't guess.
  turbopack: {
    root: __dirname,
  },
};

module.exports = nextConfig;
