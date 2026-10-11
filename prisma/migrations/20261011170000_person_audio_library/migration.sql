-- Recordings added from the recordings library keep where they came from and
-- a copy of their transcript.
ALTER TABLE "person_audio" ADD COLUMN "sourcePath" TEXT;
ALTER TABLE "person_audio" ADD COLUMN "transcript" JSONB;
ALTER TABLE "person_audio" ADD COLUMN "transcriptLanguage" TEXT;
ALTER TABLE "person_audio" ADD COLUMN "durationMs" INTEGER;

CREATE INDEX "person_audio_personId_sourcePath_idx" ON "person_audio"("personId", "sourcePath");
