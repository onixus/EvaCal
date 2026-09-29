-- AlterTable: момент последней смены статуса — от него считается срок «на этапе»
ALTER TABLE "Calculation" ADD COLUMN "stageEnteredAt" TIMESTAMP(3);
ALTER TABLE "GostPackage" ADD COLUMN "stageEnteredAt" TIMESTAMP(3);
