-- CreateTable
CREATE TABLE "person_images" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "thumbnail" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "person_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "person_images_personId_createdAt_idx" ON "person_images"("personId", "createdAt");

-- AddForeignKey
ALTER TABLE "person_images" ADD CONSTRAINT "person_images_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE CASCADE ON UPDATE CASCADE;
