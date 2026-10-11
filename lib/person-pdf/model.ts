import { getTranslations } from 'next-intl/server';
import sharp from 'sharp';
import { prisma } from '@/lib/prisma';
import { customFieldValuesInclude } from '@/lib/prisma-queries';
import { formatCanonicalName, formatGraphName } from '@/lib/nameUtils';
import { formatDate, formatDateTime, formatDateWithoutYear, parseCalendarDate, YEAR_UNKNOWN_SENTINEL, type DateFormat } from '@/lib/date-format';
import { getDateDisplayTitle } from '@/lib/important-date-types';
import { getCountryName } from '@/lib/countries';
import { isIsoDate, parseMultiSelectValue } from '@/lib/customFields/values';
import { readPhotoFile } from '@/lib/photo-storage';
import { readDocumentThumbnail } from '@/lib/person-document-storage';
import { getUserDisplayPreferences } from '@/lib/user-preferences';

/*
 * The PDF is built in two steps. This file turns a person's record into a
 * plain, already-translated model: sections of labelled fields, paragraphs and
 * dated entries. document.tsx only lays that model out. Keeping every
 * decision about what to show and how to word it here means the layout code
 * never touches Prisma or translations.
 */

type TranslationFn = (key: string, values?: Record<string, string | number | Date>) => string;

/** One value under a field label. Superseded values are drawn struck through. */
export interface PdfItem {
  tag?: string;
  text: string;
  detail?: string;
  superseded?: boolean;
}

export interface PdfField {
  label: string;
  items: PdfItem[];
}

export interface PdfEntry {
  heading: string;
  meta?: string;
  paragraphs: string[];
}

export interface PdfImage {
  data: Buffer;
  caption: string;
}

export type PdfSection =
  | { kind: 'fields'; title: string; fields: PdfField[] }
  | { kind: 'text'; title: string; paragraphs: string[] }
  | { kind: 'entries'; title: string; entries: PdfEntry[] }
  | { kind: 'images'; title: string; images: PdfImage[]; more: string | null };

export interface PersonPdfModel {
  fileBaseName: string;
  name: string;
  tags: string[];
  photo: Buffer | null;
  meta: { label: string; value: string }[];
  generated: string;
  pageLabel: string;
  sections: PdfSection[];
  labels: { appName: string };
}

/** At most this many images go into the PDF, so a large gallery stays printable. */
export const MAX_PDF_IMAGES = 24;

/**
 * Notes are Markdown. The PDF shows them as plain paragraphs: list markers
 * become bullets, links keep their address, emphasis markers are dropped.
 */
export function markdownToParagraphs(markdown: string): string[] {
  return markdown
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split('\n')
        .map((line) =>
          line
            .replace(/^\s{0,3}#{1,6}\s+/, '')
            .replace(/^\s*[-*+]\s+/, '• ')
            .replace(/^\s*>\s?/, '')
            .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
            .replace(/(\*\*|__)(.+?)\1/g, '$2')
            .replace(/(\*|_)(.+?)\1/g, '$2')
            .replace(/`([^`]+)`/g, '$1')
        )
        .join('\n')
        .trim()
    )
    .filter((block) => block.length > 0);
}

/** A safe ASCII file name stem from a display name. */
export function pdfFileBaseName(name: string): string {
  const stem = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return stem || 'contact';
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** react-pdf reads JPEG and PNG only; anything else is converted. */
async function toPdfImage(buffer: Buffer, maxSize: number): Promise<Buffer | null> {
  try {
    return await sharp(buffer, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize(maxSize, maxSize, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
  } catch {
    return null;
  }
}

function yearsAgo(date: Date, t: TranslationFn): string | null {
  const now = new Date();
  if (date >= now) return null;
  let years = now.getFullYear() - date.getFullYear();
  const m = now.getMonth() - date.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < date.getDate())) years -= 1;
  if (years < 1) return null;
  return years === 1 ? t('oneYearAgo') : t('yearsAgo', { years });
}

function reminderUnit(interval: number, unit: string, t: TranslationFn): string {
  const lower = unit.toLowerCase();
  return interval === 1 ? t(lower.slice(0, -1)) : t(lower);
}

/**
 * Load a person and build the PDF model in the user's language and date
 * format. Returns null when the person does not exist for this user.
 */
export async function buildPersonPdfModel(userId: string, personId: string): Promise<PersonPdfModel | null> {
  const person = await prisma.person.findUnique({
    where: { id: personId, userId, deletedAt: null },
    include: {
      relationshipToUser: { where: { deletedAt: null } },
      groups: { where: { group: { deletedAt: null } }, include: { group: true } },
      relationshipsTo: {
        where: { deletedAt: null, person: { deletedAt: null } },
        include: {
          person: { select: { id: true, name: true, surname: true, nickname: true, displayNameOverride: true } },
          relationshipType: { where: { deletedAt: null } },
        },
      },
      importantDates: { where: { deletedAt: null }, orderBy: { date: 'asc' } },
      phoneNumbers: true,
      emails: true,
      addresses: true,
      urls: true,
      imHandles: true,
      aliases: { orderBy: { createdAt: 'asc' } },
      fieldHistory: { orderBy: [{ validTo: 'desc' }, { createdAt: 'desc' }] },
      visits: { orderBy: [{ date: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }] },
      locations: true,
      customFieldValues: customFieldValuesInclude(),
      documents: { orderBy: { createdAt: 'asc' } },
      audio: { orderBy: [{ recordedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] },
      journalEntries: {
        where: { journalEntry: { deletedAt: null } },
        include: { journalEntry: true },
      },
    },
  });
  if (!person) return null;

  const { dateFormat: rawDateFormat, nameOrder, nameDisplayFormat } = await getUserDisplayPreferences(userId);
  const dateFormat = rawDateFormat as DateFormat;
  const t = (await getTranslations('people')) as unknown as TranslationFn;
  const tCf = (await getTranslations('customFields.person')) as unknown as TranslationFn;
  const tJournal = (await getTranslations('journal.personSection')) as unknown as TranslationFn;
  const tNav = (await getTranslations('nav')) as unknown as TranslationFn;

  const day = (d: Date | string) => formatDate(d, dateFormat);
  const history = (field: string): PdfItem[] =>
    person.fieldHistory
      .filter((h) => h.field === field)
      .map((h) => {
        const platformId = h.data && typeof h.data === 'object' && !Array.isArray(h.data) && typeof h.data.platformId === 'string'
          ? h.data.platformId
          : null;
        const period = t('history.period', {
          from: h.validFrom ? day(h.validFrom) : t('history.unknownDate'),
          to: h.validTo ? day(h.validTo) : t('history.unknownDate'),
        });
        return {
          tag: h.type ?? undefined,
          text: h.value,
          detail: platformId ? `${t('history.platformId', { id: platformId })}  ${period}` : period,
          superseded: true,
        };
      });
  const field = (label: string, items: PdfItem[]): PdfField[] => (items.length > 0 ? [{ label, items }] : []);

  const sections: PdfSection[] = [];

  // Personal details
  const fullName = [person.prefix, formatCanonicalName(person, nameOrder), person.suffix].filter(Boolean).join(' ');
  const personal: PdfField[] = [
    ...field(t('fullName'), [{ text: fullName }, ...history('name')]),
    ...field(t('form.displayNameOverrideLabel'), person.displayNameOverride ? [{ text: person.displayNameOverride }] : []),
    ...field(t('nickname'), [...(person.nickname ? [{ text: person.nickname }] : []), ...history('nickname')]),
    ...field(
      t('otherNames'),
      person.aliases.map((a) => ({
        tag: ['nickname', 'formerName', 'otherScript', 'other'].includes(a.type) ? t(`form.aliases.types.${a.type}`) : a.type,
        text: a.name,
        detail: a.script ?? undefined,
      }))
    ),
    ...field(t('gender'), person.gender ? [{ text: person.gender }] : []),
  ];
  if (person.anniversary) {
    const d = parseCalendarDate(person.anniversary);
    const ago = yearsAgo(d, t);
    personal.push({ label: t('anniversary'), items: [{ text: day(d), detail: ago ?? undefined }] });
  }
  if (person.relationshipToUser) {
    personal.push({ label: t('relationshipToUser'), items: [{ text: person.relationshipToUser.label }] });
  }
  const lastContactReminder =
    person.contactReminderEnabled && person.contactReminderInterval && person.contactReminderIntervalUnit
      ? t('remindAfter', {
          interval: person.contactReminderInterval,
          unit: reminderUnit(person.contactReminderInterval, person.contactReminderIntervalUnit, t),
        })
      : undefined;
  personal.push({
    label: t('lastTimeTalked'),
    items: [
      person.lastContact
        ? { text: day(person.lastContact), detail: lastContactReminder }
        : { text: t('noContactRecorded'), detail: lastContactReminder },
    ],
  });
  sections.push({ kind: 'fields', title: t('personalDetails'), fields: personal });

  // Professional
  const professional: PdfField[] = [
    ...field(t('organization'), [...(person.organization ? [{ text: person.organization }] : []), ...history('organization')]),
    ...field(t('jobTitle'), [...(person.jobTitle ? [{ text: person.jobTitle }] : []), ...history('jobTitle')]),
  ];
  if (professional.length > 0) sections.push({ kind: 'fields', title: t('professional'), fields: professional });

  // Contact information
  const contact: PdfField[] = [
    ...field(t('phoneNumbers'), [...person.phoneNumbers.map((p) => ({ tag: p.type, text: p.number })), ...history('phone')]),
    ...field(t('emailAddresses'), [...person.emails.map((e) => ({ tag: e.type, text: e.email })), ...history('email')]),
    ...field(t('addresses'), [
      ...person.addresses.map((a) => ({
        tag: a.type,
        text: [
          a.streetLine1,
          a.streetLine2,
          [a.locality, a.region, a.postalCode].filter(Boolean).join(', '),
          a.country ? getCountryName(a.country) || a.country : null,
        ]
          .filter(Boolean)
          .join('\n'),
      })),
      ...history('address'),
    ]),
  ];
  if (contact.length > 0) sections.push({ kind: 'fields', title: t('contactInformation'), fields: contact });

  // Online presence
  const online: PdfField[] = [
    ...field(t('websites'), [...person.urls.map((u) => ({ tag: u.type, text: u.url })), ...history('url')]),
    ...field(t('instantMessaging'), [
      ...person.imHandles.map((im) => ({
        tag: im.protocol,
        text: im.handle,
        detail: im.platformId ? t('platformIdValue', { id: im.platformId }) : undefined,
      })),
      ...history('im'),
    ]),
  ];
  if (online.length > 0) sections.push({ kind: 'fields', title: t('onlinePresence'), fields: online });

  // Coordinates
  if (person.locations.length > 0) {
    sections.push({
      kind: 'fields',
      title: t('locations'),
      fields: [{
        label: t('locations'),
        items: person.locations.map((l) => ({
          tag: l.type,
          text: `${Number(l.latitude)}, ${Number(l.longitude)}`,
          detail: l.label ?? undefined,
        })),
      }],
    });
  }

  // Important dates
  if (person.importantDates.length > 0) {
    sections.push({
      kind: 'fields',
      title: t('importantDates'),
      fields: person.importantDates.map((d) => {
        const date = parseCalendarDate(d.date);
        const yearUnknown = date.getFullYear() <= YEAR_UNKNOWN_SENTINEL;
        const ago = yearUnknown ? null : yearsAgo(date, t);
        return {
          label: getDateDisplayTitle(d, (key: string) => t(`form.importantDates.${key}`)),
          items: [{ text: yearUnknown ? formatDateWithoutYear(date, dateFormat) : day(date), detail: ago ?? undefined }],
        };
      }),
    });
  }

  // Custom fields
  if (person.customFieldValues.length > 0) {
    const linkedIds = person.customFieldValues.filter((v) => v.template.type === 'PERSON').map((v) => v.value);
    const linked = linkedIds.length > 0
      ? await prisma.person.findMany({
          where: { id: { in: linkedIds }, userId, deletedAt: null },
          select: { id: true, name: true, surname: true, nickname: true, displayNameOverride: true },
        })
      : [];
    sections.push({
      kind: 'fields',
      title: tCf('sectionTitle'),
      fields: person.customFieldValues.map((v) => {
        let text = v.value;
        switch (v.template.type) {
          case 'BOOLEAN':
            text = v.value === 'true' ? tCf('booleanYes') : tCf('booleanNo');
            break;
          case 'DATE':
            text = isIsoDate(v.value) ? day(v.value) : v.value;
            break;
          case 'MULTI_SELECT':
            text = (parseMultiSelectValue(v.value) ?? []).join(', ');
            break;
          case 'PERSON': {
            const p = linked.find((l) => l.id === v.value);
            text = p ? formatGraphName(p, nameOrder, nameDisplayFormat) : tCf('linkedPersonMissing');
            break;
          }
        }
        return { label: v.template.name, items: [{ text }] };
      }),
    });
  }

  // Location history
  if (person.visits.length > 0) {
    sections.push({
      kind: 'fields',
      title: t('visits.title'),
      fields: [{
        label: t('visits.location'),
        items: person.visits.map((v) => ({
          tag: v.date ? day(v.date) : t('visits.unknownDate'),
          text: v.location,
          detail: v.motivation ?? undefined,
        })),
      }],
    });
  }

  // Notes
  if (person.notes) {
    sections.push({ kind: 'text', title: t('notes'), paragraphs: markdownToParagraphs(person.notes) });
  }

  // Relationships
  const relItems = person.relationshipsTo.map((r) => ({
    tag: r.relationshipType?.label,
    text: formatGraphName(r.person, nameOrder, nameDisplayFormat),
    detail: r.notes ?? undefined,
  }));
  if (relItems.length > 0) {
    sections.push({ kind: 'fields', title: t('relationships'), fields: [{ label: t('otherRelationships'), items: relItems }] });
  }

  // Journal
  const journal = person.journalEntries
    .map((link) => link.journalEntry)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  if (journal.length > 0) {
    sections.push({
      kind: 'entries',
      title: tJournal('title'),
      entries: journal.map((e) => ({
        heading: e.title,
        meta: e.hasTime ? formatDateTime(e.date, dateFormat) : day(e.date),
        paragraphs: markdownToParagraphs(e.body),
      })),
    });
  }

  // Attached files, listed by name
  const nonImages = person.documents.filter((d) => !d.mimeType.startsWith('image/'));
  if (nonImages.length > 0) {
    sections.push({
      kind: 'fields',
      title: t('documents.title'),
      fields: [{
        label: t('documents.title'),
        items: nonImages.map((d) => ({ text: d.originalName, detail: `${formatBytes(d.size)}  ${day(d.createdAt)}` })),
      }],
    });
  }
  if (person.audio.length > 0) {
    sections.push({
      kind: 'fields',
      title: t('audio.title'),
      fields: [{
        label: t('audio.title'),
        items: person.audio.map((a) => ({
          text: a.originalName,
          detail: a.recordedAt ? formatDateTime(a.recordedAt.toISOString().slice(0, 16), dateFormat) : formatBytes(a.size),
        })),
      }],
    });
  }

  // Images, from their thumbnails
  const imageDocs = person.documents.filter((d) => d.mimeType.startsWith('image/'));
  if (imageDocs.length > 0) {
    const images: PdfImage[] = [];
    for (const doc of imageDocs.slice(0, MAX_PDF_IMAGES)) {
      const location = doc.sha256
        ? { kind: 'blob' as const, sha256: doc.sha256 }
        : doc.legacyFilename
          ? { kind: 'legacy' as const, personId: person.id, legacyFilename: doc.legacyFilename }
          : null;
      if (!location) continue;
      const thumb = await readDocumentThumbnail(userId, location);
      const data = thumb ? await toPdfImage(thumb.buffer, 600) : null;
      if (data) images.push({ data, caption: doc.originalName });
    }
    if (images.length > 0) {
      const hidden = imageDocs.length - images.length;
      sections.push({
        kind: 'images',
        title: t('pdf.images'),
        images,
        more: hidden > 0 ? t('pdf.moreImages', { count: hidden }) : null,
      });
    }
  }

  // Profile photo
  let photo: Buffer | null = null;
  if (person.photo) {
    const file = await readPhotoFile(userId, person.photo);
    if (file) photo = await toPdfImage(file.buffer, 400);
  }

  const displayName = formatGraphName(person, nameOrder, nameDisplayFormat);
  return {
    fileBaseName: pdfFileBaseName(displayName),
    name: fullName || displayName,
    tags: person.groups.map((g) => g.group.name),
    photo,
    meta: [
      { label: t('record.id'), value: person.id },
      { label: t('record.created'), value: day(person.createdAt) },
      { label: t('record.updated'), value: day(person.updatedAt) },
    ],
    generated: t('pdf.generated', { date: formatDateTime(new Date(), dateFormat) }),
    pageLabel: t('pdf.page', { page: '{page}', total: '{total}' }),
    sections,
    labels: { appName: tNav('appName') },
  };
}
