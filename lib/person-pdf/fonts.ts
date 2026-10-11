import fs from 'fs';
import path from 'path';
import { Font } from '@react-pdf/renderer';

/*
 * Fonts for the PDF. IBM Plex covers Latin, Cyrillic and Greek and comes from
 * npm, so it is always there. Chinese, Japanese and Korean need a separate
 * font: the Docker image installs Noto Sans CJK, and PDF_CJK_FONT can point
 * at any other TTF, OTF or TTC file. Without one, CJK characters in names or
 * notes come out as empty boxes, and everything else is unaffected.
 */

export const PDF_SANS = 'HyperionSans';
export const PDF_MONO = 'HyperionMono';
const PDF_CJK = 'HyperionCJK';

const PLEX_SANS_DIR = path.join(process.cwd(), 'node_modules/@ibm/plex-sans/fonts/complete/woff');
const PLEX_MONO_DIR = path.join(process.cwd(), 'node_modules/@ibm/plex-mono/fonts/complete/woff');

// Where common distributions put Noto Sans CJK. The first two are Alpine
// (the Docker image) and Debian/Ubuntu.
const CJK_CANDIDATES = [
  '/usr/share/fonts/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
];

let registered = false;
let cjkAvailable = false;

function findCjkFont(): string | null {
  const configured = process.env.PDF_CJK_FONT?.trim();
  if (configured) return fs.existsSync(configured) ? configured : null;
  return CJK_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** Register the PDF fonts once per process. Safe to call on every request. */
export function registerPdfFonts(): void {
  if (registered) return;

  Font.register({
    family: PDF_SANS,
    fonts: [
      { src: path.join(PLEX_SANS_DIR, 'IBMPlexSans-Regular.woff'), fontWeight: 400 },
      { src: path.join(PLEX_SANS_DIR, 'IBMPlexSans-Italic.woff'), fontWeight: 400, fontStyle: 'italic' },
      { src: path.join(PLEX_SANS_DIR, 'IBMPlexSans-SemiBold.woff'), fontWeight: 600 },
    ],
  });
  Font.register({
    family: PDF_MONO,
    fonts: [
      { src: path.join(PLEX_MONO_DIR, 'IBMPlexMono-Regular.woff'), fontWeight: 400 },
      { src: path.join(PLEX_MONO_DIR, 'IBMPlexMono-SemiBold.woff'), fontWeight: 600 },
    ],
  });

  const cjk = findCjkFont();
  if (cjk) {
    // A .ttc bundles several fonts; pick the Simplified Chinese face, which
    // also carries kana and hangul.
    const postscriptName = cjk.toLowerCase().endsWith('.ttc') ? 'NotoSansCJKsc-Regular' : undefined;
    Font.register({
      family: PDF_CJK,
      fonts: [
        { src: cjk, fontWeight: 400, postscriptName },
        { src: cjk, fontWeight: 600, postscriptName },
        { src: cjk, fontWeight: 400, fontStyle: 'italic', postscriptName },
      ],
    });
    cjkAvailable = true;
  }

  // Names and addresses must never be split with a hyphen.
  Font.registerHyphenationCallback((word) => [word]);

  registered = true;
}

/** Font family list for a style: the main face first, CJK as fallback. */
export function pdfFamily(main: typeof PDF_SANS | typeof PDF_MONO): string[] {
  return cjkAvailable ? [main, PDF_CJK] : [main];
}
