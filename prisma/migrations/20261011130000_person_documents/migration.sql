-- CreateTable
CREATE TABLE "person_documents" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "sha256" TEXT,
    "legacyFilename" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "hasThumbnail" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_documents_personId_createdAt_idx" ON "person_documents"("personId", "createdAt");

-- CreateIndex
CREATE INDEX "person_documents_sha256_idx" ON "person_documents"("sha256");

-- AddForeignKey
ALTER TABLE "person_documents" ADD CONSTRAINT "person_documents_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over the image folder. The files stay where they are until the app
-- moves them into the hashed store on its next start (see
-- lib/person-document-migration.ts); until then they are served from the old path.
INSERT INTO "person_documents" ("id", "personId", "sha256", "legacyFilename", "originalName", "mimeType", "size", "width", "height", "hasThumbnail", "createdAt")
SELECT
    "id",
    "personId",
    NULL,
    "filename",
    'image_' || to_char("createdAt", 'YYYYMMDD_HH24MISS') || CASE WHEN "filename" LIKE '%.png' THEN '.png' ELSE '.jpg' END,
    CASE WHEN "filename" LIKE '%.png' THEN 'image/png' ELSE 'image/jpeg' END,
    "size",
    "width",
    "height",
    true,
    "createdAt"
FROM "person_images";

-- DropTable
DROP TABLE "person_images";
