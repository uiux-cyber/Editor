import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Builds the MCP bridge (src/mcp/kinora-mcp.ts) into one self-contained CommonJS file,
 * out/mcp/kinora-mcp.cjs. The installer ships it unpacked in resources\mcp, where Claude starts it
 * with Kinora.exe in Node mode (see docs/CLAUDE-CONNECTOR.md).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  define: { __KINORA_VERSION__: JSON.stringify(pkg.version) },
  build: {
    ssr: resolve(__dirname, 'src/mcp/kinora-mcp.ts'),
    outDir: resolve(__dirname, 'out/mcp'),
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    sourcemap: false,
    rollupOptions: {
      output: { format: 'cjs', entryFileNames: 'kinora-mcp.cjs' },
    },
  },
});
