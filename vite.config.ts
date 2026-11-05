import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The preview build is one self-contained HTML file that always runs the demo
// household, so it has no use for config.js, the manifest or icon files.
const stripInstallTags = (): Plugin => ({
  name: 'strip-install-tags',
  transformIndexHtml: (html) =>
    html
      .replace(/\s*<script src="\.\/config\.js"><\/script>/, '')
      .replace(/\s*<link rel="(manifest|icon|apple-touch-icon)"[^>]*>/g, ''),
});

// `npm run build` makes the real app (deployed to GitHub Pages).
// `npm run build:preview` makes the single-file demo.
export default defineConfig(({ mode }) => {
  const preview = mode === 'preview';
  return {
    base: './',
    plugins: preview ? [react(), stripInstallTags(), viteSingleFile()] : [react()],
    define: { __PREVIEW__: JSON.stringify(preview) },
    build: {
      outDir: preview ? 'dist-preview' : 'dist',
      emptyOutDir: true,
      copyPublicDir: !preview,
    },
  };
});
