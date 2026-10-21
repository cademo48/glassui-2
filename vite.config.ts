import { defineConfig } from 'vite';
import { capturePlugin } from './dev/capture-plugin.ts';

export default defineConfig({
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
  preview: { host: '127.0.0.1', port: 5189, strictPort: true },
  plugins: [capturePlugin()],
  // three.js is most of the single bundle (about 150 kB gzipped); that's expected, not a warning.
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
});
