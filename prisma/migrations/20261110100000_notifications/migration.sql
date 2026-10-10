-- #103 WP-3b: уведомления внутри приложения и очередь «Требует моего действия».
-- Перечисления хранятся как TEXT + CHECK (см. 20261010110000_commercial_pricing_mode).

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB,
    "dueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_kind_entityId_dueAt_key" ON "Notification"("userId", "kind", "entityId", "dueAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_kind_check"
  CHECK ("kind" IN ('assigned', 'deputy_assigned', 'returned', 'overdue', 'comment_reply', 'comment_fixed'));
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_entityType_check"
  CHECK ("entityType" IN ('gost_package', 'review_assignment', 'review_comment'));
-- Просрочка без срока не бывает: иначе уникальность не держала бы идемпотентность.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_overdue_due_check"
  CHECK ("kind" <> 'overdue' OR "dueAt" IS NOT NULL);
