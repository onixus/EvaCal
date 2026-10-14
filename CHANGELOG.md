# Changelog

## Unreleased

- SheetJS `xlsx` 0.20.3 is vendored as `vendor/xlsx-0.20.3.tgz` instead of the moving `xlsx-latest` CDN URL: `npm ci` and Docker builds no longer break on a new SheetJS release (integrity mismatch) or on `cdn.sheetjs.com` timeouts.

## 0.8.0 - 2026-10-11

- Catalog in the database: vendors, technical products and revision-bound price offers; reviewed vendor GPL imports with reusable import profiles, snapshot comparison and applying selected GPL updates to a project as a new draft (#101, #108).
- Specification totals, XLSX output, revision diff, lifecycle with confirmed release and BOM import; manual supply composition and pinned revisions in studio preview and export (#101).
- Versioned sizing profiles and runs with impact on the specification (#101, see [docs/sizing.md](docs/sizing.md)).
- Commercial offer: target margin separated from markup (historical quotes preserved), variant comparison, profit forecast, supply and cost items, exchange rates and a margin threshold with discount approvals (#102, #103, see [docs/commercial-pricing.md](docs/commercial-pricing.md)).
- Change requests: card, impact view, specialist estimate, accept/reject/defer/reopen with a versioned result and a "baseline + changes" summary (#103, see [docs/change-requests.md](docs/change-requests.md)).
- Acceptance checks bound to an approved package edition, commission decision and PSI/act generated from recorded facts (#103, see [docs/acceptance.md](docs/acceptance.md)).
- Personal review stage assignments and comment lifecycle (#103).
- Actuals ledger with idempotent sync and template norm proposals from actuals (#103, see [docs/actuals-ledger.md](docs/actuals-ledger.md), [docs/norm-proposals.md](docs/norm-proposals.md)).
- Versioned solution library and applying solution kits to projects with update proposals (#103, see [docs/solution-library.md](docs/solution-library.md), [docs/kit-application.md](docs/kit-application.md)).
- GOST 34 PZ/TZ no longer invent platforms or supply items; presale sizing defaults are marked as unconfirmed assumptions.
- Presale picks the template and product for a calculation itself; hidden templates are no longer returned.
- Migrated to Tailwind CSS 4; runtime dependency vulnerabilities fixed.
- nginx config and certificate bind mounts are relabeled for SELinux (`:ro,z`), so installations on SELinux-enforcing hosts (RHEL, Fedora) no longer fail with `Permission denied` on `nginx.conf`.
- Specification rows can reference GOST package requirements (`requirementIds`); unknown ids are saved with a warning, requirement codes are copied into the revision and printed in SPEC DOCX/XLSX, and the traceability matrix shows the supplying rows. Sizing metrics propose catalog candidates (several alternatives with quantity and cost from confirmed offers, unknown price stays unknown); a candidate is added to a draft only on explicit choice. Sizing inputs are no longer reset when the profile list reloads (#101, see [docs/specification.md](docs/specification.md), [docs/sizing.md](docs/sizing.md)).

- Compliance evidence (software/hardware registry entries and certificates) per catalog product with source, check date, exact applicability, status and validity; SPEC and PZ print only current confirmed evidence of confirmed rows, otherwise «Не подтверждено»; the static vendor registry is removed (#101, see [docs/specification.md](docs/specification.md)).
- "Требует моего действия" queue (`/inbox`) with in-app notifications on review assignment, return, comment reply, fix and its verification/rejection/reopening; repeated rejection of an already returned package is refused (409); lazy idempotent overdue notifications; delayed projects show reason, named responsible and next step (#103).
- **Behaviour change:** GOST package document types are stored sorted (`["pmi","tz"]`), and review lines compare them order-insensitively. Existing versions of one calculation that differ only in document order now form a single review line: open comments carry forward between them and the newer version supersedes the older one (#103).
- Catalog relations (replaced/alternative products, bundle composition), typed attribute definitions, a review queue for manual rows proposed to the catalog, explicit replacement of replaced products in a project as a new draft, and the `subscription`/`bundle` item kinds; bundle components never enter totals (#101, see [docs/specification.md](docs/specification.md)).
- Production calendars, calendar exceptions and role reservations shared by the Gantt and the capacity plan (#103, see [docs/work-calendars.md](docs/work-calendars.md)).
- **Behaviour change:** Gantt dates are now computed in UTC with a 09:00 UTC working window. On servers with `TZ` ≠ UTC, Gantts rebuilt after the upgrade (stage edit or start-date change) shift relative to dates stored earlier; existing stage dates are not rewritten.
- Explicit stage dependencies (FS + lag in working days), nearest available start date by role capacity, and side-by-side what-if variants (start shift / contractor / team change) on the capacity plan (#103, see [docs/stage-dependencies.md](docs/stage-dependencies.md)).
- **Behaviour change:** applying what-if shifts (`POST /api/capacity/apply`) no longer moves stage dates by the same number of calendar days. The Gantt is rescheduled in place from the new start date using the template's production calendar and stage dependencies, so a holiday or weekend in the new window lengthens stages and the end date may move by more or fewer days than the shift. Stage ids and recorded actuals are kept.
- **Behaviour change:** editing stages or the start date updates stage rows in place instead of recreating them: stage actuals, actuals-ledger entries, tracker task mappings and dependencies are kept; ledger entries of a removed stage stay unassigned (`stageId` null). Custom customer-approval durations are kept across reload/save.

See [release notes](docs/releases/v0.8.0.md) for upgrade notes and installation instructions.

## 0.7.0 - 2026-09-30

- Make PostgreSQL the sole supported application database, preserving existing migration history.
- Rebuild installation, paired image distribution, upgrades and PostgreSQL backup/restore.
- Fix local HTTP sessions, nginx replacement and deployment behavior on Linux.
- Exclude legacy database files from production images while preserving customer database requirement matching.
- Publish both production images on Linux with isolated registry credentials.

See [release notes](docs/releases/v0.7.0.md) for compatibility and installation instructions.
