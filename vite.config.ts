import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 项目站部署在 /<仓库名>/ 子路径下，相对 base 保证资源可加载
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    watch: {
      // Reference photos in the workspace root are frequently rewritten/locked by viewers.
      // They are served as static evidence, never imported by the app, so excluding them
      // keeps Vite's watcher from crashing with EBUSY on Windows.
      ignored: ['**/*.jpg', '**/*.jpeg', '**/*.JPG', '**/*.JPEG'],
    },
  },
});
