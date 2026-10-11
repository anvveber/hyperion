import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import {
  validateCustomFieldValues,
  CustomFieldValidationError,
} from '../../lib/customFields/persistence';

type PrismaArg = Parameters<typeof validateCustomFieldValues>[0];

function fakePrisma(personIds: string[]) {
  const personFindMany = vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
    where.id.in.filter((id) => personIds.includes(id)).map((id) => ({ id }))
  );
  const prisma = {
    customFieldTemplate: {
      findMany: vi.fn(async () => [
        { id: 'tpl-person', name: 'Best friend', type: 'PERSON', options: [] },
        { id: 'tpl-text', name: 'Note', type: 'TEXT', options: [] },
      ]),
    },
    person: { findMany: personFindMany },
  };
  return { prisma: prisma as unknown as PrismaArg, personFindMany };
}

describe('validateCustomFieldValues with PERSON fields', () => {
  it("accepts a link to one of the user's people", async () => {
    const { prisma, personFindMany } = fakePrisma(['person-2']);

    await expect(
      validateCustomFieldValues(prisma, 'user-1', [{ templateId: 'tpl-person', value: 'person-2' }])
    ).resolves.toBeUndefined();

    expect(personFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['person-2'] }, userId: 'user-1', deletedAt: null },
      select: { id: true },
    });
  });

  it('rejects a link to a person the user does not have (or who is in the trash)', async () => {
    const { prisma } = fakePrisma([]);

    await expect(
      validateCustomFieldValues(prisma, 'user-1', [{ templateId: 'tpl-person', value: 'person-x' }])
    ).rejects.toBeInstanceOf(CustomFieldValidationError);
  });

  it('does not look up people when no PERSON field is set', async () => {
    const { prisma, personFindMany } = fakePrisma([]);

    await validateCustomFieldValues(prisma, 'user-1', [{ templateId: 'tpl-text', value: 'hi' }]);

    expect(personFindMany).not.toHaveBeenCalled();
  });
});
