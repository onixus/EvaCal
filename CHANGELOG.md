# Changelog

## Unreleased

- "Требует моего действия" queue (`/inbox`) with in-app notifications on review assignment, return, comment reply, fix and its verification/rejection/reopening; repeated rejection of an already returned package is refused (409); lazy idempotent overdue notifications; delayed projects show reason, named responsible and next step (#103).
- **Behaviour change:** GOST package document types are stored sorted (`["pmi","tz"]`), and review lines compare them order-insensitively. Existing versions of one calculation that differ only in document order now form a single review line: open comments carry forward between them and the newer version supersedes the older one (#103).
- Catalog relations (replaced/alternative products, bundle composition), typed attribute definitions, a review queue for manual rows proposed to the catalog, explicit replacement of replaced products in a project as a new draft, and the `subscription`/`bundle` item kinds; bundle components never enter totals (#101, see [docs/specification.md](docs/specification.md)).
- Production calendars, calendar exceptions and role reservations shared by the Gantt and the capacity plan (#103, see [docs/work-calendars.md](docs/work-calendars.md)).
- **Behaviour change:** Gantt dates are now computed in UTC with a 09:00 UTC working window. On servers with `TZ` ≠ UTC, Gantts rebuilt after the upgrade (stage edit or start-date change) shift relative to dates stored earlier; existing stage dates are not rewritten.
- Explicit stage dependencies (FS + lag in working days), nearest available start date by role capacity, and side-by-side what-if variants (start shift / contractor / team change) on the capacity plan (#103, see [docs/stage-dependencies.md](docs/stage-dependencies.md)).
- **Behaviour change:** applying what-if shifts (`POST /api/capacity/apply`) no longer moves stage dates by the same number of calendar days. The Gantt is rescheduled in place from the new start date using the template's production calendar and stage dependencies, so a holiday or weekend in the new window lengthens stages and the end date may move by more or fewer days than the shift. Stage ids and recorded actuals are kept.
- **Behaviour change:** editing stages or the start date updates stage rows in place instead of recreating them: stage actuals, actuals-ledger entries, tracker task mappings and dependencies are kept; ledger entries of a removed stage stay unassigned (`stageId` null). Custom customer-approval durations are kept across reload/save.

## 0.7.0 - 2026-09-30

- Make PostgreSQL the sole supported application database, preserving existing migration history.
- Rebuild installation, paired image distribution, upgrades and PostgreSQL backup/restore.
- Fix local HTTP sessions, nginx replacement and deployment behavior on Linux.
- Exclude legacy database files from production images while preserving customer database requirement matching.
- Publish both production images on Linux with isolated registry credentials.

See [release notes](docs/releases/v0.7.0.md) for compatibility and installation instructions.
