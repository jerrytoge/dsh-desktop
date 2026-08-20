// Build the macOS app icon (build/icon.icns) from the DeepSeek whale logo.
//
// The whale path is read directly from the harness's own favicon
// (node_modules/@deepseek-ai/dsh-web-frontend/dist/favicon.svg), which is the
// official DeepSeek whale. We recolor it to the DeepSeek brand blue (#4D6BFE)
// on a white background, render every iconset size with sharp, then run
// iconutil to produce the .icns.

import sharp from 'sharp';
import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BLUE = '#4D6BFE'; // DeepSeek brand blue
const BG = '#FFFFFF';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const faviconPath = path.join(
  root,
  'node_modules',
  '@deepseek-ai',
  'dsh-web-frontend',
  'dist',
  'favicon.svg'
);

const favicon = readFileSync(faviconPath, 'utf8');
const match = favicon.match(/\bd="([^"]+)"/);
if (!match) {
  console.error('make-icon: could not extract the whale path from', faviconPath);
  process.exit(1);
}
const whale = match[1];

// Iconset filename -> pixel size (macOS: 1x and @2x for each point size).
const SIZES = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024],
];

function whaleSvg(size) {
  const target = size * 0.78; // whale occupies 78% of the canvas
  const scale = target / 50; // favicon viewBox is 50x50
  const pad = (size - target) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <g transform="translate(${pad.toFixed(2)},${pad.toFixed(2)}) scale(${scale.toFixed(4)})">
    <path d="${whale}" fill="${BLUE}" fill-rule="nonzero"/>
  </g>
</svg>`;
}

const iconset = path.join(root, 'build', 'icon.iconset');
const icns = path.join(root, 'build', 'icon.icns');

rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset, { recursive: true });

for (const [name, size] of SIZES) {
  const out = path.join(iconset, name);
  await sharp(Buffer.from(whaleSvg(size))).png().toFile(out);
  console.log('make-icon: wrote', path.relative(root, out));
}

execSync(`iconutil -c icns "${iconset}" -o "${icns}"`, { stdio: 'inherit' });
console.log('make-icon: wrote', path.relative(root, icns));
