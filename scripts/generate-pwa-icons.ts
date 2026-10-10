/**
 * Generates the app icons and raster logos from public/logo.svg.
 *
 * Run manually after changing the logo or the icon composition:
 *   npx tsx scripts/generate-pwa-icons.ts
 *
 * Outputs are committed, so there is no build-time step.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PUBLIC_DIR = path.join(process.cwd(), 'public');
const LOGO = path.join(PUBLIC_DIR, 'logo.svg');
const OUT_DIR = path.join(PUBLIC_DIR, 'icons');

/** Dark-theme background, so the icon matches the app's console look. */
const GROUND = '#000000';
/** logo.svg viewBox size. The eye fills it edge to edge. */
const VIEW_W = 804;
const VIEW_H = 502;

interface Target {
  file: string;
  size: number;
  /** Eye width as a fraction of the icon width. */
  fraction: number;
}

const TARGETS: Target[] = [
  // purpose: any. iOS applies only a gentle squircle, so the eye can fill more.
  { file: 'icon-192.png', size: 192, fraction: 0.78 },
  { file: 'icon-512.png', size: 512, fraction: 0.78 },
  // purpose: maskable. Android may crop to any shape and only guarantees a
  // centred circle of 80% of the width, so the eye must stay smaller.
  { file: 'maskable-192.png', size: 192, fraction: 0.62 },
  { file: 'maskable-512.png', size: 512, fraction: 0.62 },
  { file: 'apple-touch-icon.png', size: 180, fraction: 0.78 },
  // 1024 variants: on high density Android devices, the splash screen icon is
  // drawn at more device pixels than 512, so Chrome upscales the 512 asset.
  { file: 'icon-1024.png', size: 1024, fraction: 0.78 },
  { file: 'maskable-1024.png', size: 1024, fraction: 0.62 },
];

/** Renders the logo centred on a square of `size`, `fraction` of its width. */
async function renderSquare(svg: Buffer, size: number, fraction: number, background: string | null): Promise<Buffer> {
  const width = Math.round(size * fraction);
  const eye = await sharp(svg, { density: 72 * (width / VIEW_W) * 2 })
    .resize({ width })
    .png()
    .toBuffer();
  const height = Math.round(width * (VIEW_H / VIEW_W));
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: eye, left: Math.round((size - width) / 2), top: Math.round((size - height) / 2) }])
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  const svg = readFileSync(LOGO);
  mkdirSync(OUT_DIR, { recursive: true });

  for (const { file, size, fraction } of TARGETS) {
    const image = await renderSquare(svg, size, fraction, GROUND);
    // Flatten in a second pass (sharp applies composite after flatten): iOS
    // composites any transparency to black, and the icons must be opaque.
    await sharp(image).flatten({ background: GROUND }).png({ compressionLevel: 9 }).toFile(path.join(OUT_DIR, file));
    console.log(`wrote public/icons/${file}`);
  }

  // Transparent rasters for places that cannot use the SVG (emails, favicon).
  await sharp(svg, { density: 72 * (1200 / VIEW_W) })
    .resize({ width: 1200 })
    .png({ compressionLevel: 9 })
    .toFile(path.join(PUBLIC_DIR, 'logo.png'));
  console.log('wrote public/logo.png');

  for (const [file, size] of [
    ['logo_square.png', 1200],
    ['icon.png', 128],
  ] as const) {
    const image = await renderSquare(svg, size, 0.94, null);
    await sharp(image).png({ compressionLevel: 9 }).toFile(path.join(PUBLIC_DIR, file));
    console.log(`wrote public/${file}`);
  }

  // app/favicon.ico has always been a 256px PNG; browsers accept that.
  const favicon = await renderSquare(svg, 256, 0.94, GROUND);
  await sharp(favicon).flatten({ background: GROUND }).png({ compressionLevel: 9 }).toFile(path.join(process.cwd(), 'app', 'favicon.ico'));
  console.log('wrote app/favicon.ico');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
