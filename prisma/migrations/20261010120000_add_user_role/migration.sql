-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

-- Existing installs: the oldest account becomes the admin, so someone can
-- still create accounts once public signup is closed.
UPDATE "users" SET "role" = 'ADMIN'
WHERE "id" = (SELECT "id" FROM "users" ORDER BY "createdAt" ASC, "id" ASC LIMIT 1);
