// Generate a two-tone purple DSH Desktop icon concept without replacing build/icon.icns.
// The official whale path remains unchanged. A darker purple is clipped into the
// tail and lower fin to suggest attachable modules around a stable host core.

import sharp from 'sharp';
import { readFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PRIMARY = '#7559E8';
const MODULE = '#5637C8';
const BACKGROUND = '#F8F7FC';
const SIZE = 1024;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const linkedFavicon = path.join(
  root,
  'node_modules',
  '@deepseek-ai',
  'dsh-web-frontend',
  'dist',
  'favicon.svg',
);
const pnpmRoot = path.join(root, 'node_modules', '.pnpm');
const pnpmPackage = readdirSync(pnpmRoot).find((name) =>
  name.startsWith('@deepseek-ai+dsh-web-frontend@'),
);
const pnpmFavicon = pnpmPackage
  ? path.join(
      pnpmRoot,
      pnpmPackage,
      'node_modules',
      '@deepseek-ai',
      'dsh-web-frontend',
      'dist',
      'favicon.svg',
    )
  : '';
const faviconPath = existsSync(linkedFavicon) ? linkedFavicon : pnpmFavicon;
if (!faviconPath || !existsSync(faviconPath)) {
  throw new Error('Could not locate @deepseek-ai/dsh-web-frontend favicon.svg');
}

const favicon = readFileSync(faviconPath, 'utf8');
const match = favicon.match(/\bd="([^"]+)"/);
if (!match) throw new Error(`Could not extract whale path from ${faviconPath}`);
const whale = match[1];

function conceptSvg() {
  const target = SIZE * 0.78;
  const scale = target / 50;
  const pad = (SIZE - target) / 2;
  const transform = `translate(${pad.toFixed(2)},${pad.toFixed(2)}) scale(${scale.toFixed(4)})`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
    <rect width="${SIZE}" height="${SIZE}" rx="220" fill="${BACKGROUND}"/>
    <defs>
      <clipPath id="whale-clip">
        <path d="${whale}" transform="${transform}" fill-rule="nonzero"/>
      </clipPath>
    </defs>

    <!-- Stable host core -->
    <path d="${whale}" transform="${transform}" fill="${PRIMARY}" fill-rule="nonzero"/>

    <!-- Attach-on modules: curved joins follow the whale's motion instead of hard cuts. -->
    <g clip-path="url(#whale-clip)" fill="${MODULE}">
      <!-- Tail module: its left edge is a soft S-curve along the tail root. -->
      <path d="M748 135 C690 194 735 260 684 326 C664 352 665 381 684 412 L970 412 L970 120 Z"/>
      <!-- Lower module: deliberately smaller to keep the host core dominant. -->
      <path d="M674 704 C710 675 778 680 823 714 C854 738 859 772 840 803 C816 840 747 852 696 824 C650 799 642 746 674 704 Z"/>
    </g>
  </svg>`;
}

const outDir = path.join(root, 'build', 'concepts');
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'icon-purple-modular-v2.png');
await sharp(Buffer.from(conceptSvg())).png().toFile(out);
console.log(path.relative(root, out));
