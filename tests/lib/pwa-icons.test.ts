import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ICONS_DIR = path.join(process.cwd(), 'public', 'icons');

const EXPECTED = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'maskable-192.png', size: 192 },
  { file: 'maskable-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-1024.png', size: 1024 },
  { file: 'maskable-1024.png', size: 1024 },
];

describe('PWA icons', () => {
  for (const { file, size } of EXPECTED) {
    describe(file, () => {
      const full = path.join(ICONS_DIR, file);

      it('exists', () => {
        expect(existsSync(full)).toBe(true);
      });

      it(`is a ${size}x${size} PNG`, async () => {
        const meta = await sharp(full).metadata();
        expect(meta.format).toBe('png');
        expect(meta.width).toBe(size);
        expect(meta.height).toBe(size);
      });

      // iOS composites any transparency to black, which would frame the icon
      // in a black box on the home screen.
      it('is fully opaque', async () => {
        const meta = await sharp(full).metadata();
        expect(meta.hasAlpha).toBe(false);
      });

      it('is not a blank square', async () => {
        const { channels } = await sharp(full).stats();
        // The ground is black and the eye is mostly white, so any channel
        // separates them. Real renders measure well above 20, which is a
        // meaningful floor without being brittle to small compositional
        // changes.
        expect(channels[2].stdev).toBeGreaterThan(20);
      });
    });
  }

  it('renders the maskable variant with more padding than the any variant', async () => {
    // The eye is smaller in the maskable icon, so more of the frame is the
    // flat black ground, which means less overall variance.
    const anyStats = await sharp(path.join(ICONS_DIR, 'icon-512.png')).stats();
    const maskStats = await sharp(path.join(ICONS_DIR, 'maskable-512.png')).stats();
    expect(maskStats.channels[2].stdev).toBeLessThan(anyStats.channels[2].stdev);
  });
});
