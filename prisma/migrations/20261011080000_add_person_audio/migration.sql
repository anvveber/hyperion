-- CreateTable
CREATE TABLE "person_audio" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3),
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_audio_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_audio_personId_recordedAt_idx" ON "person_audio"("personId", "recordedAt");

-- AddForeignKey
ALTER TABLE "person_audio" ADD CONSTRAINT "person_audio_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
