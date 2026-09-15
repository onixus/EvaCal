# --- deps: install dependencies ---
FROM node:22.14-alpine3.21 AS deps
WORKDIR /app
# The `prepare` script runs format+typecheck for local installs and skips itself when CI
# is set. Only package.json and the lockfile exist at this layer, so without CI it would
# run those against a source-less directory and fail the install.
ENV CI=true
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: generate prisma client and build the app ---
FROM node:22.14-alpine3.21 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts резолвит DATABASE_URL при любом запуске CLI, включая `prisma generate`
# на этапе сборки. К базе здесь никто не обращается — реальное значение приходит из
# docker-compose в runtime; это заглушка, совпадающая с путём тома /app/prisma.
ENV DATABASE_URL="file:./prisma/dev.db"
# Клиент компилирует SQL под диалект из схемы, поэтому СУБД выбирается на сборке.
# По умолчанию PostgreSQL; встраиваемый SQLite — --build-arg DATABASE_PROVIDER=sqlite
# (см. docker-compose.yml).
ARG DATABASE_PROVIDER=postgresql
ENV DATABASE_PROVIDER=$DATABASE_PROVIDER
RUN npm run build

# --- migrate: one-off schema sync + seed (scripts/db-sync.ts: `db push` для SQLite, `migrate deploy` для PostgreSQL; затем db:seed) ---
# Kept separate from `runner` so the app image stays slim; the CLI and its schema-engine
# binary aren't needed to serve requests, only to initialize/update the DB before startup.
FROM node:22.14-alpine3.21 AS migrate
LABEL org.opencontainers.image.source="https://github.com/onixus/EvaCal"
WORKDIR /app
# su-exec drops from root (needed to chown the mounted volume) to the app's uid before running prisma,
# so files in the volume end up owned by the same uid the runner stage serves requests as.
RUN apk add --no-cache su-exec \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY lib ./lib
COPY scripts ./scripts
COPY reset-all.ts ./
ARG DATABASE_PROVIDER=postgresql
ENV DATABASE_PROVIDER=$DATABASE_PROVIDER
COPY docker-migrate-entrypoint.sh /usr/local/bin/docker-migrate-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-migrate-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-migrate-entrypoint.sh"]
# В Prisma 7 у `db push` больше нет флага --skip-generate: команда и так не генерирует
# клиент, поэтому generate вызывается отдельно — seed импортирует сгенерированный клиент.
CMD ["sh", "-c", "npx tsx scripts/db-sync.ts && npx prisma generate && npx tsx prisma/seed.ts"]

# --- runner: minimal production image ---
FROM node:22.14-alpine3.21 AS runner
# OCI-метки: по image.source GHCR привязывает пакет к репозиторию, и образ
# появляется на странице Packages репозитория с его README и правами.
LABEL org.opencontainers.image.source="https://github.com/onixus/EvaCal" \
      org.opencontainers.image.title="EvaCal" \
      org.opencontainers.image.description="Калькулятор трудозатрат и генератор комплекта ГОСТ 34"
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone output bundles only the files needed to run the server.
# public/ должен существовать в репозитории даже пустым — см. public/.gitkeep.
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma

USER nextjs
EXPOSE 3000

# Адрес числовой, а не localhost: в этом образе localhost резолвится сначала
# в IPv6 ([::1]), а next standalone слушает только 0.0.0.0:3000. Проба уходила
# на ::1, получала connection refused, и контейнер навсегда оставался unhealthy
# при полностью работающем приложении.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
