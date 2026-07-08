// PostCSS config for the renderer. Tailwind v4 is loaded via @tailwindcss/postcss
// rather than the @tailwindcss/vite plugin (which is ESM-only and breaks the
// CJS build context — see vite.renderer.config.ts). Vite resolves this file
// relative to the project root regardless of the renderer `root`.
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
