import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/nodeLogger.ts'],
  outDir: 'dist',
  clean: true,
  format: ['esm', 'cjs'],
});
