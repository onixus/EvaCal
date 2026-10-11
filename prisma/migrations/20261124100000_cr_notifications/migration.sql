-- #103 §1: уведомления о запросах на изменение — новые виды и сущность.
-- Перечисления — TEXT + CHECK: ограничения пересоздаются с расширенным списком.

ALTER TABLE "Notification" DROP CONSTRAINT "Notification_kind_check";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_kind_check"
  CHECK ("kind" IN ('assigned', 'deputy_assigned', 'returned', 'overdue', 'comment_reply',
    'comment_fixed', 'comment_verified', 'comment_rejected', 'comment_reopened',
    'cr_submitted', 'cr_reopened', 'cr_estimated', 'cr_accepted', 'cr_rejected', 'cr_deferred'));

ALTER TABLE "Notification" DROP CONSTRAINT "Notification_entityType_check";
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_entityType_check"
  CHECK ("entityType" IN ('gost_package', 'review_assignment', 'review_comment', 'change_request'));

-- Вид и сущность согласованы: виды cr_* относятся только к запросу на изменение.
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_cr_entity_check"
  CHECK (("kind" IN ('cr_submitted', 'cr_reopened', 'cr_estimated', 'cr_accepted',
    'cr_rejected', 'cr_deferred')) = ("entityType" = 'change_request'));
