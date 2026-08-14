/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // better-sqlite3 — нативный модуль (.node), его нельзя бандлить: без этого он не
  // попадает в standalone-вывод и прод-образ падает при первом обращении к БД.
  serverExternalPackages: ['better-sqlite3', '@prisma/adapter-better-sqlite3'],
  // pdfkit reads its own data files (AFM metrics etc.) via fs + __dirname internally,
  // which breaks once webpack bundles it into a single file. Keep it external so Node
  // requires the real package from node_modules at runtime instead.
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push('pdfkit');
    }
    return config;
  },
};

module.exports = nextConfig;
