-- #103 WP-5d: производственные календари, исключения и резервы ролей.

CREATE TABLE "WorkCalendar" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "name" TEXT NOT NULL,
 "isDefault" BOOLEAN NOT NULL DEFAULT false,
 "weekendDays" TEXT NOT NULL DEFAULT '6,7',
 "note" TEXT,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CHECK (length("name") BETWEEN 1 AND 200),
 -- Не больше шести выходных: хотя бы один день недели должен быть рабочим.
 CHECK ("weekendDays" ~ '^([1-7](,[1-7]){0,5})?$')
);
-- Ровно один календарь по умолчанию: частичный уникальный индекс.
CREATE UNIQUE INDEX "WorkCalendar_single_default_key" ON "WorkCalendar"("isDefault") WHERE "isDefault";

CREATE TABLE "CalendarException" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "calendarId" TEXT NOT NULL,
 "date" DATE NOT NULL,
 "kind" TEXT NOT NULL,
 "hours" DOUBLE PRECISION,
 "note" TEXT,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("kind" IN ('holiday', 'workday', 'short')),
 CHECK ("hours" IS NULL OR ("kind" = 'short' AND "hours" > 0 AND "hours" <= 8)),
 CONSTRAINT "CalendarException_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "WorkCalendar"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CalendarException_calendarId_date_key" ON "CalendarException"("calendarId", "date");

CREATE TABLE "RoleReservation" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "role" TEXT NOT NULL,
 "from" DATE NOT NULL,
 "to" DATE NOT NULL,
 "hoursPerWeek" DOUBLE PRECISION NOT NULL,
 "reason" TEXT NOT NULL,
 "createdBy" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("to" >= "from"),
 CHECK ("hoursPerWeek" > 0 AND "hoursPerWeek" <= 400),
 CHECK (length("reason") BETWEEN 1 AND 500),
 CHECK ("role" <> 'customer')
);
CREATE INDEX "RoleReservation_role_from_idx" ON "RoleReservation"("role", "from");

ALTER TABLE "FormTemplate" ADD COLUMN "calendarId" TEXT;
ALTER TABLE "FormTemplate" ADD CONSTRAINT "FormTemplate_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "WorkCalendar"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Календарь по умолчанию: сб и вс выходные, исключений нет. Праздники
-- конкретного года вносит администратор (/admin/calendars) — год здесь не
-- зашит, чтобы миграция не устаревала.
INSERT INTO "WorkCalendar" ("id", "name", "isDefault", "weekendDays", "note", "createdBy", "updatedAt")
VALUES ('default-work-calendar', 'Основной (пн–пт)', true, '6,7',
        'Создан миграцией. Праздники и переносы добавляет администратор.', 'system', CURRENT_TIMESTAMP);
