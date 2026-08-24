// Build the macOS app icon (build/icon.icns) from the DeepSeek whale logo.
//
// The official whale path is preserved. DSH Desktop uses a two-tone purple
// treatment: the host core stays bright purple while the tail and lower fin
// use a darker purple to suggest attachable plugin modules. Every iconset size
// is rendered with sharp before iconutil produces the .icns.

import sharp from 'sharp';
import { execSync } from 'node:child_process';
import {
  readFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readdirSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PRIMARY = '#654CFF';
const MODULE = '#3824C7';
const BG = '#FFFFFF';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const linkedFavicon = path.join(
  root,
  'node_modules',
  '@deepseek-ai',
  'dsh-web-frontend',
  'dist',
  'favicon.svg'
);
const pnpmRoot = path.join(root, 'node_modules', '.pnpm');
const pnpmPackage = existsSync(pnpmRoot)
  ? readdirSync(pnpmRoot).find((name) =>
      name.startsWith('@deepseek-ai+dsh-web-frontend@')
    )
  : undefined;
const pnpmFavicon = pnpmPackage
  ? path.join(
      pnpmRoot,
      pnpmPackage,
      'node_modules',
      '@deepseek-ai',
      'dsh-web-frontend',
      'dist',
      'favicon.svg'
    )
  : '';
const faviconPath = existsSync(linkedFavicon) ? linkedFavicon : pnpmFavicon;
if (!faviconPath || !existsSync(faviconPath)) {
  console.error('make-icon: could not locate the official favicon.svg');
  process.exit(1);
}

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
  const transform = `translate(${pad.toFixed(2)},${pad.toFixed(2)}) scale(${scale.toFixed(4)})`;
  const unit = size / 1024;
  const n = (value) => (value * unit).toFixed(2);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${n(220)}" fill="${BG}"/>
  <defs>
    <clipPath id="whale-clip">
      <path d="${whale}" transform="${transform}" fill-rule="nonzero"/>
    </clipPath>
  </defs>
  <path d="${whale}" transform="${transform}" fill="${PRIMARY}" fill-rule="nonzero"/>
  <g clip-path="url(#whale-clip)" fill="${MODULE}" transform="scale(${unit.toFixed(6)})">
    <path d="M748 135 C690 194 735 260 684 326 C664 352 665 381 684 412 L970 412 L970 120 Z"/>
    <path d="M674 704 C710 675 778 680 823 714 C854 738 859 772 840 803 C816 840 747 852 696 824 C650 799 642 746 674 704 Z"/>
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
