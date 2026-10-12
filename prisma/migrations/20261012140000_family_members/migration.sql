-- Family location sharing: who shares, as which OwnTracks user and device,
-- and which hyperion account (if any) is theirs. Positions are not stored.
CREATE TABLE "family_members" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "recorderUser" TEXT NOT NULL,
    "recorderDevice" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "family_members_userId_key" ON "family_members"("userId");
CREATE UNIQUE INDEX "family_members_recorderUser_recorderDevice_key" ON "family_members"("recorderUser", "recorderDevice");

ALTER TABLE "family_members" ADD CONSTRAINT "family_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A person record can point at the family member it is, for the minimap.
ALTER TABLE "people" ADD COLUMN "familyMemberId" TEXT;
ALTER TABLE "people" ADD CONSTRAINT "people_familyMemberId_fkey" FOREIGN KEY ("familyMemberId") REFERENCES "family_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
