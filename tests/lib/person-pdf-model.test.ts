import { describe, expect, it, vi } from 'vitest';

// The helpers under test are pure; stub the server-only imports the module pulls in.
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn() }));

import { markdownToParagraphs, pdfFileBaseName } from '@/lib/person-pdf/model';

describe('markdownToParagraphs', () => {
  it('splits on blank lines and keeps line breaks inside a block', () => {
    expect(markdownToParagraphs('First line\nsecond line\n\nNext block')).toEqual([
      'First line\nsecond line',
      'Next block',
    ]);
  });

  it('drops heading markers and emphasis', () => {
    expect(markdownToParagraphs('## Preferences\n**bold** and _italic_ and `code`')).toEqual([
      'Preferences\nbold and italic and code',
    ]);
  });

  it('turns list items into bullets', () => {
    expect(markdownToParagraphs('- one\n* two\n+ three')).toEqual(['• one\n• two\n• three']);
  });

  it('keeps link addresses and drops image markup', () => {
    expect(markdownToParagraphs('See [the blog](https://example.com) ![pic](a.png)')).toEqual([
      'See the blog (https://example.com) pic',
    ]);
  });

  it('handles Windows line endings and empty input', () => {
    expect(markdownToParagraphs('a\r\n\r\nb')).toEqual(['a', 'b']);
    expect(markdownToParagraphs('')).toEqual([]);
  });
});

describe('pdfFileBaseName', () => {
  it('makes a lowercase hyphenated ASCII name', () => {
    expect(pdfFileBaseName('John Smith')).toBe('john-smith');
  });

  it('strips accents', () => {
    expect(pdfFileBaseName('Zoë Müller-Lüdenscheidt')).toBe('zoe-muller-ludenscheidt');
  });

  it('falls back when nothing ASCII is left', () => {
    expect(pdfFileBaseName('约翰')).toBe('contact');
    expect(pdfFileBaseName('  ')).toBe('contact');
  });
});
