import { copyFile } from 'node:fs/promises';
import { modelPlugins } from './model-build-options.mjs';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
await build({ entryPoints: [root + 'main.mjs'], bundle: true, format: 'esm', platform: 'browser', target: ['safari17', 'chrome130'], outfile: root + 'build/renderer.js', sourcemap: true, legalComments: 'eof', plugins: modelPlugins });

