# --- deps: install dependencies ---
FROM node:20-alpine AS deps
WORKDIR /app
# The `prepare` script runs format+typecheck for local installs and skips itself when CI
# is set. Only package.json and the lockfile exist at this layer, so without CI it would
# run those against a source-less directory and fail the install.
ENV CI=true
COPY package.json package-lock.json ./
RUN npm ci

# --- builder: generate prisma client and build the app ---
FROM node:20-alpine AS builder
WORKDIR /app
# Alpine ships libssl but no `openssl` CLI; Prisma's engine-detection shells out to it and
# silently falls back to the wrong (openssl-1.1.x) binary target without it.
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# --- migrate: one-off schema sync + seed (prisma db push and db:seed against the mounted SQLite volume) ---
# Kept separate from `runner` so the app image stays slim; the CLI and its schema-engine
# binary aren't needed to serve requests, only to initialize/update the DB before startup.
FROM node:20-alpine AS migrate
WORKDIR /app
# su-exec drops from root (needed to chown the mounted volume) to the app's uid before running prisma,
# so files in the volume end up owned by the same uid the runner stage serves requests as.
RUN apk add --no-cache openssl su-exec \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY prisma ./prisma
COPY lib ./lib
COPY docker-migrate-entrypoint.sh /usr/local/bin/docker-migrate-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-migrate-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-migrate-entrypoint.sh"]
CMD ["sh", "-c", "npx prisma db push --skip-generate && npx prisma generate && npx tsx prisma/seed.ts"]

# --- runner: minimal production image ---
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN apk add --no-cache openssl \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone output bundles only the files needed to run the server.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
