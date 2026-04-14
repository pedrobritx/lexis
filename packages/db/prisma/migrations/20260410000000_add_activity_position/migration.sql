-- AlterTable: add position to activities (default 0)
ALTER TABLE "activities" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
