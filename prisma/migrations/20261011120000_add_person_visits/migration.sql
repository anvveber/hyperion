-- CreateTable
CREATE TABLE "person_visits" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "date" TIMESTAMP(3),
    "location" TEXT NOT NULL,
    "motivation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "person_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_visits_personId_date_idx" ON "person_visits"("personId", "date");

-- AddForeignKey
ALTER TABLE "person_visits" ADD CONSTRAINT "person_visits_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
