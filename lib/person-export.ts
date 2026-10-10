import type { Prisma } from '@prisma/client';
import { formatFullName } from '@/lib/nameUtils';

// Shared by the full account export (/api/user/export) and the single-person
// export (/api/people/[id]/export) so both produce the same person shape.
export const personExportInclude = {
  relationshipToUser: {
    select: {
      id: true,
      name: true,
      label: true,
    },
  },
  groups: {
    where: { group: { deletedAt: null } },
    include: {
      group: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  relationshipsFrom: {
    where: { deletedAt: null, relatedPerson: { deletedAt: null } },
    include: {
      relatedPerson: {
        select: {
          id: true,
          name: true,
          surname: true,
          nickname: true,
          displayNameOverride: true,
        },
      },
      relationshipType: {
        select: {
          id: true,
          name: true,
          label: true,
        },
      },
    },
  },
  importantDates: {
    where: { deletedAt: null },
    select: {
      title: true,
      date: true,
    },
  },
  phoneNumbers: {
    select: { type: true, number: true },
  },
  emails: {
    select: { type: true, email: true },
  },
  addresses: {
    select: {
      type: true,
      streetLine1: true,
      streetLine2: true,
      locality: true,
      region: true,
      postalCode: true,
      country: true,
    },
  },
  urls: {
    select: { type: true, url: true },
  },
  imHandles: {
    select: { protocol: true, handle: true },
  },
  locations: {
    select: { type: true, latitude: true, longitude: true, label: true },
  },
  customFields: {
    select: { key: true, value: true, type: true },
  },
  customFieldValues: {
    where: { template: { deletedAt: null } },
    select: { value: true, template: { select: { slug: true } } },
  },
} satisfies Prisma.PersonInclude;

export type PersonForExport = Prisma.PersonGetPayload<{ include: typeof personExportInclude }>;

export function serializePersonForExport(person: PersonForExport) {
  return {
    id: person.id,
    name: person.name,
    middleName: person.middleName,
    secondLastName: person.secondLastName,
    surname: person.surname,
    nickname: person.nickname,
    displayNameOverride: person.displayNameOverride,
    prefix: person.prefix,
    suffix: person.suffix,
    organization: person.organization,
    jobTitle: person.jobTitle,
    photo: person.photo,
    gender: person.gender,
    anniversary: person.anniversary,
    lastContact: person.lastContact,
    notes: person.notes,
    contactReminderEnabled: person.contactReminderEnabled,
    contactReminderInterval: person.contactReminderInterval,
    contactReminderIntervalUnit: person.contactReminderIntervalUnit,
    importantDates: person.importantDates.map((d) => ({
      title: d.title,
      date: d.date,
    })),
    phoneNumbers: person.phoneNumbers.map((p) => ({
      type: p.type,
      number: p.number,
    })),
    emails: person.emails.map((e) => ({
      type: e.type,
      email: e.email,
    })),
    addresses: person.addresses.map((a) => ({
      type: a.type,
      streetLine1: a.streetLine1,
      streetLine2: a.streetLine2,
      locality: a.locality,
      region: a.region,
      postalCode: a.postalCode,
      country: a.country,
    })),
    urls: person.urls.map((u) => ({
      type: u.type,
      url: u.url,
    })),
    imHandles: person.imHandles.map((im) => ({
      protocol: im.protocol,
      handle: im.handle,
    })),
    locations: person.locations.map((l) => ({
      type: l.type,
      latitude: l.latitude,
      longitude: l.longitude,
      label: l.label,
    })),
    customFields: person.customFields.map((cf) => ({
      key: cf.key,
      value: cf.value,
      type: cf.type,
    })),
    customFieldValues: person.customFieldValues.map((cfv) => ({
      slug: cfv.template.slug,
      value: cfv.value,
    })),
    relationshipToUser: person.relationshipToUser
      ? {
          name: person.relationshipToUser.name,
          label: person.relationshipToUser.label,
        }
      : null,
    groups: person.groups.map((pg) => pg.group.name),
    relationships: person.relationshipsFrom.map((rel) => ({
      relatedPersonId: rel.relatedPersonId,
      relatedPersonName: formatFullName(rel.relatedPerson),
      relationshipType: rel.relationshipType
        ? {
            name: rel.relationshipType.name,
            label: rel.relationshipType.label,
          }
        : null,
      notes: rel.notes,
    })),
  };
}
