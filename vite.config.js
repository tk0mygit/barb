import { defineConfig } from 'vite';

export default defineConfig({
  base: '/barb/',
  build: {
    rollupOptions: { output: { manualChunks: (id) => id.includes('/node_modules/three/') ? 'three' : undefined } },
  },
});
