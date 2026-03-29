import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const outdir = 'dist/public';

// Bundle TypeScript
await esbuild.build({
  entryPoints: ['src/web/frontend/app.ts'],
  bundle: true,
  minify: true,
  sourcemap: true,
  outfile: path.join(outdir, 'app.js'),
  target: 'es2020',
  format: 'iife',
});

// Copy static files
fs.copyFileSync('src/web/frontend/index.html', path.join(outdir, 'index.html'));
fs.copyFileSync('src/web/frontend/styles.css', path.join(outdir, 'styles.css'));

console.log('Frontend built to dist/public/');
