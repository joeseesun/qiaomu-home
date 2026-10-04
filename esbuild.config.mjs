import { build, context } from 'esbuild';
import { readFileSync } from 'node:fs';
const options = {
  entryPoints: ['src/main.ts'], bundle: true, minify: true, external: ['obsidian', 'electron'], format: 'cjs', target: 'es2022',
  outfile: 'main.js', logLevel: 'info', sourcemap: false,
  banner: { js: '/*! Qiaomu Home — Copyright (c) 2026 向阳乔木; GPL-3.0-only. Source: https://github.com/joeseesun/qiaomu-home\nThe Qiaomu Home Protocol file (src/protocol/qiaomu-home.ts) is MIT licensed. Wallpapers: Unsplash License, credited in the page.\nWeather locations: GeoNames contributors, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Source: https://download.geonames.org/export/dump/; filtered, rounded and deduplicated snapshot 2026-10-04. */' },
};
if (process.argv.includes('--watch')) await (await context(options)).watch();
else {
  await build(options);
  for (const asset of ['main.js', 'styles.css']) {
    if (readFileSync(asset).byteLength > 5_000_000) throw new Error(`${asset} exceeds the 5 MB release budget`);
  }
}
