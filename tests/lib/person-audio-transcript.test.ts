import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { parseStoredTranscript } from '@/lib/person-audio';
import { formatOffset } from '@/lib/transcript-format';

describe('parseStoredTranscript', () => {
  it('keeps well-formed segments', () => {
    expect(parseStoredTranscript([{ s: 0, e: 1200, t: 'Ciao' }, { s: 1200, e: 2000, t: 'come va' }])).toEqual([
      { s: 0, e: 1200, t: 'Ciao' },
      { s: 1200, e: 2000, t: 'come va' },
    ]);
  });

  it('drops malformed entries and returns null when nothing is left', () => {
    expect(parseStoredTranscript([{ s: '0', e: 1, t: 'x' }, null, [1, 2], { s: 0, e: 1 }])).toBeNull();
    expect(parseStoredTranscript(null)).toBeNull();
    expect(parseStoredTranscript({ s: 0, e: 1, t: 'x' })).toBeNull();
  });
});

describe('formatOffset', () => {
  it('formats minutes and hours', () => {
    expect(formatOffset(0)).toBe('0:00');
    expect(formatOffset(65_400)).toBe('1:05');
    expect(formatOffset(3_723_000)).toBe('1:02:03');
    expect(formatOffset(-5)).toBe('0:00');
  });
});
