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
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY drizzle ./drizzle
COPY scripts/backup.js ./scripts/backup.js
COPY app.json ./
USER node
EXPOSE 3000
CMD ["node", "build"]
