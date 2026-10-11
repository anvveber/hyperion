-- AlterTable
ALTER TABLE "person_im_handles" ADD COLUMN "platformId" TEXT;

-- CreateTable
CREATE TABLE "person_aliases" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "script" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "person_field_history" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "type" TEXT,
    "value" TEXT NOT NULL,
    "data" JSONB,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_field_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_aliases_personId_idx" ON "person_aliases"("personId");

-- CreateIndex
CREATE INDEX "person_field_history_personId_field_idx" ON "person_field_history"("personId", "field");

-- AddForeignKey
ALTER TABLE "person_aliases" ADD CONSTRAINT "person_aliases_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "person_field_history" ADD CONSTRAINT "person_field_history_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
