#!/bin/bash
set -e

echo "🚀 Cleaning up old builds and lockfiles..."

# Ensure we are inside the correct project folder
cd "$(dirname "$0")"

# Remove Next.js build output
rm -rf .next

# Remove stray lockfile in home directory (causing root confusion)
if [ -f "/Users/moguljordan23/package-lock.json" ]; then
  echo "⚠️  Removing stray package-lock.json at /Users/moguljordan23/"
  rm -f /Users/moguljordan23/package-lock.json
fi

# Make sure next.config.js has proper root set
if ! grep -q "turbopack" next.config.js 2>/dev/null; then
  echo "⚙️  Adding turbopack.root to next.config.js..."
  cat > next.config.js <<EOL
/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: __dirname,
};

module.exports = nextConfig;
EOL
fi

echo "📦 Installing dependencies..."
npm install

echo "🏗️  Building project..."
npm run build

echo "✅ Build finished. Starting production server..."
npm start
