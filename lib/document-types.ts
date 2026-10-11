// File types the document folder shows in the browser. Shared by the API (to
// decide between inline and attachment) and the folder UI (to pick a viewer).
// Anything else is only offered as a download.

const INLINE_TYPES: Record<string, DocumentKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'image/avif': 'image',
  'application/pdf': 'pdf',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/ogg': 'audio',
  'audio/wav': 'audio',
  'audio/flac': 'audio',
  'text/plain': 'text',
};

export type DocumentKind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'other';

export function documentKind(mimeType: string): DocumentKind {
  return INLINE_TYPES[mimeType] ?? 'other';
}

export function isInlineMimeType(mimeType: string): boolean {
  return mimeType in INLINE_TYPES;
}

/**
 * Short label for a file tile without a thumbnail, from the file extension
 * ("PDF", "DOCX") or, failing that, the MIME subtype.
 */
export function fileTypeLabel(originalName: string, mimeType: string): string {
  const ext = /\.([a-z0-9]{1,5})$/i.exec(originalName)?.[1];
  if (ext) return ext.toUpperCase();
  const subtype = mimeType.split('/')[1] ?? '';
  return subtype && subtype !== 'octet-stream' ? subtype.slice(0, 5).toUpperCase() : 'FILE';
}
