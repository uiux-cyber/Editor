import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

/**
 * On-device AI workers load ONNX Runtime's WebAssembly from the bundled models folder
 * (kinora://models/ort/). Drop the ~27 MB copy Vite would otherwise emit next to the worker.
 */
const dropOrtWasm = {
  name: 'kinora-drop-ort-wasm',
  generateBundle(_options: unknown, bundle: Record<string, unknown>): void {
    for (const file of Object.keys(bundle)) if (/(^|\/)ort-wasm[^/]*\.wasm$/.test(file)) delete bundle[file];
  },
};

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
      },
    },
    plugins: [react()],
    worker: { plugins: () => [dropOrtWasm] },
    server: {
      headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
    },
    build: {
      target: 'chrome140',
      chunkSizeWarningLimit: 4000,
    },
  },
});
