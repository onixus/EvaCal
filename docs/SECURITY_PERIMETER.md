# Security perimeter (Horizon A)

Implemented 2026-08-13.

## Rules

| Surface | Access |
|---------|--------|
| `GET /api/calculations` (list) | staff only (`architect` \| `admin`) |
| `POST /api/calculations` (create) | staff **or** share(`create`) **or** `ALLOW_ANONYMOUS_PRESALE` |
| `GET/PUT` calculation by id | staff **or** share bound to id (`read` / `write`) |
| export PDF/XLSX/JSON/GOST34 | staff **or** share (`export`; implies `read`) |
| `submit` | staff **or** share (`write`) |
| GOST migration apply | staff only |
| GOST LLM / parse / generate | staff (unchanged) |
| users / templates admin | `admin` (unchanged) |

## Share tokens

- HMAC-signed (`SHARE_TOKEN_SECRET` or `SESSION_SECRET`), default TTL 7 days.
- Issue: `POST /api/calculations/:id/share` (staff) with `{ scopes, ttlSeconds? }`.
- Send as `X-Share-Token`, `Authorization: Share <token>`, or `?share=`.
- On anonymous/share create, API returns `{ id, shareToken }` for the new calculation; UI stores it in `sessionStorage`.

## Anonymous mode

```bash
ALLOW_ANONYMOUS_PRESALE=true   # local demos ONLY
```

Unset/false in production.

## Audit

`AuditEvent` table: login, create/update/delete/submit/export/share/migrate.

## Cookies

`HttpOnly` + `SameSite=Lax` + `Secure` when `NODE_ENV=production` or `FORCE_SECURE_COOKIES=true`.

## Ops

```bash
# SQLite volume backup (compose volume db-data)
docker compose run --rm migrate sh -c 'cp prisma/dev.db prisma/dev.db.bak-$(date +%Y%m%d%H%M%S)'
```

## CI

Jenkins `npm audit --audit-level=high` fails the build (no `|| true`).
