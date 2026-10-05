# Build: install everything and build the app. No secrets are needed here; the app reads its
# settings from the environment when it starts.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Dependencies don't need install scripts: better-sqlite3 ships prebuilt binaries, and esbuild
# installs its binary as a regular package. Skipping them also keeps dependency code out of the
# build step.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build && npm prune --omit=dev

# Run: production dependencies, the built app, migrations, the backup script and app.json
# (Dokku reads its health check and nightly backup schedule from there).
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
# Saving a recipe with a photo sends up to about 3.5 MB, and adapter-node refuses request bodies
# over 512K by default. nginx has its own limit, raised once on the server with
# `dokku nginx:set meals client-max-body-size 5m` (README, "One-time server setup").
ENV BODY_SIZE_LIMIT=5M
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY drizzle ./drizzle
COPY scripts/backup.js ./scripts/backup.js
COPY app.json ./
USER node
EXPOSE 3000
CMD ["node", "build"]
