-- Positions are now received by hyperion itself instead of an OwnTracks
-- Recorder. Each member logs in with a username and password, and only the
-- last position is kept.

DROP INDEX "family_members_recorderUser_recorderDevice_key";

ALTER TABLE "family_members" RENAME COLUMN "recorderUser" TO "username";
ALTER TABLE "family_members" DROP COLUMN "recorderDevice";

ALTER TABLE "family_members"
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "lastLat" DOUBLE PRECISION,
  ADD COLUMN "lastLon" DOUBLE PRECISION,
  ADD COLUMN "lastAcc" DOUBLE PRECISION,
  ADD COLUMN "lastBatt" INTEGER,
  ADD COLUMN "lastAt" TIMESTAMP(3);

-- Two Recorder devices of the same user would now collide; keep the oldest.
DELETE FROM "family_members" a
  USING "family_members" b
  WHERE a."username" = b."username" AND a."createdAt" > b."createdAt";

CREATE UNIQUE INDEX "family_members_username_key" ON "family_members"("username");
