# Security perimeter (Horizon A)

Implemented 2026-08-13.

## Rules

| Surface                           | Access                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| `GET /` (archive UI)              | staff only; guests see landing without data                   |
| `GET /presale`                    | form if staff / anonymous / create-share; draft list staff    |
| `GET /presale/:id`                | staff **or** `?share=` **or** anonymous flag                  |
| `GET /api/calculations` (list)    | staff only (`architect` \| `admin`)                           |
| `POST /api/calculations` (create) | staff **or** share(`create`) **or** `ALLOW_ANONYMOUS_PRESALE` |
| `GET/PUT` calculation by id       | staff **or** share bound to id (`read` / `write`)             |
| export PDF/XLSX/JSON/GOST34       | staff **or** share (`export`; implies `read`)                 |
| `submit`                          | staff **or** share (`write`)                                  |
| GOST migration apply              | staff only                                                    |
| GOST LLM / parse / generate       | staff (unchanged)                                             |
| `POST /api/gost34/draft-tz`        | staff only (`GOST34_LLM_ROLES`; share/anonymous forbidden)   |
| `POST /api/gost34/draft-tz/decision` | staff only (`GOST34_LLM_ROLES`; share/anonymous forbidden) |
| users / templates admin           | `admin` (unchanged)                                           |

## Share tokens

- HMAC-signed (`SHARE_TOKEN_SECRET` or `SESSION_SECRET`), default TTL 7 days.
- Issue: `POST /api/calculations/:id/share` (staff) with `{ scopes, ttlSeconds? }`.
- Send as `X-Share-Token`, `Authorization: Share <token>`, or `?share=`.
- On anonymous/share create, API returns `{ id, shareToken }` for the new calculation; UI stores it in `sessionStorage` and navigates to `/presale/:id?share=…` so RSC can authorize.
- If the page loads without session/`?share=`, `ShareTokenRecovery` retries from `sessionStorage`.
- **TZ Author routes (`/draft-tz`, `/draft-tz/decision`) strictly forbid share tokens**: returns `403 Forbidden` if accessed via share token or anonymous session.

## Anonymous mode

```bash
ALLOW_ANONYMOUS_PRESALE=true   # local demos ONLY
```

Unset/false in production.

## Audit & LLM Redaction

- `AuditEvent` table: login, create/update/delete/submit/export/share/migrate, and `gost34.tz_author.*`.
- **No LLM text/prompts in Audit**: All LLM audit entries (`gost34.tz_author.draft`, `gost34.tz_author.accept`, `gost34.tz_author.reject`) pass through `redactLlmMeta`. Prompts, model completions, section paragraphs, and context payloads are strictly scrubbed; only diagnostic meta (`nodeId`, `providerId`, `model`, `promptVersion`, `flagCodes`, `latencyMs`, `status`, `usedLlm`) is retained.
- Custom `endpoint` parameters in request bodies are ignored by the server to prevent SSRF.
- Hard flags block acceptance and document export with HTTP 409 (`TzAuthorHardFlagsError`).

## Cookies

`HttpOnly` + `SameSite=Lax` + `Secure` when `NODE_ENV=production` or `FORCE_SECURE_COOKIES=true`.

## Ops

```bash
# SQLite volume backup (compose volume db-data)
docker compose run --rm migrate sh -c 'cp prisma/dev.db prisma/dev.db.bak-$(date +%Y%m%d%H%M%S)'
```

## CI

Jenkins `npm audit --audit-level=high` fails the build (no `|| true`).
