# --- deps: install dependencies ---
FROM node:22.14-alpine3.21 AS deps
WORKDIR /app
# prepare requires sources locally; in a dependency-only layer it must be skipped.
ENV CI=true
COPY package.json package-lock.json ./
RUN npm ci

# --- builder ---
FROM node:22.14-alpine3.21 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/evacal" npm run build

# --- migrate: one-off schema sync + seed ---
FROM node:22.14-alpine3.21 AS migrate
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/onixus/EvaCal" \
      org.opencontainers.image.revision=$VCS_REF
WORKDIR /app
RUN apk add --no-cache su-exec \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY lib ./lib
COPY scripts ./scripts
COPY reset-all.ts ./
# Клиент готов в образе: запуск/обновление не требует npm или Prisma из сети.
RUN DATABASE_URL="postgresql://build:build@127.0.0.1:5432/evacal" npx --no-install prisma generate
COPY docker-entrypoint.sh docker-migrate-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh /usr/local/bin/docker-migrate-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-migrate-entrypoint.sh"]
CMD ["sh", "-c", "npx --no-install tsx scripts/db-sync.ts && npx --no-install tsx prisma/seed.ts"]

# --- runner: minimal production image ---
FROM node:22.14-alpine3.21 AS runner
ARG VCS_REF=unknown
LABEL org.opencontainers.image.source="https://github.com/onixus/EvaCal" \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.title="EvaCal" \
      org.opencontainers.image.description="Калькулятор трудозатрат и генератор комплекта ГОСТ 34"
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /app/storage \
  && chown nextjs:nodejs /app/storage
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
