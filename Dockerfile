# Build: install everything and build the app. No secrets are needed here; the app reads its
# settings from the environment when it starts.
# Both stages start from node:26-slim pinned by digest, so the base image changes only in a pull
# request, which CI tests: Dependabot proposes each new one (.github/dependabot.yml, MEA-105).
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Dependencies don't need install scripts: better-sqlite3 ships prebuilt binaries, and esbuild and
# sharp install theirs (sharp's with libvips) as regular packages. Skipping them also keeps
# dependency code out of the build step.
RUN npm ci --ignore-scripts
COPY . .
# The commit being built, which /healthz answers with (deploy.yml passes it, vite.config.ts reads
# it).
ARG COMMIT
RUN npm run build && npm prune --omit=dev

# Run: production dependencies, the built app, migrations, the standard items' images (design
# 6.14), the default dishes' photos (6.19), the backup script and app.json (Dokku reads its health
# check and nightly backup schedule from there).
FROM node:26-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc
WORKDIR /app
ENV NODE_ENV=production
# Saving a recipe with a photo, or an item with an image, sends up to about 3.5 MB, and
# adapter-node refuses request bodies over 512K by default. Only the recipe editor, Items, Import
# recipes and feedback (with a screenshot of up to 3 MB) may send more than 64 KB
# (src/lib/server/body-size.ts). nginx has its own limit, raised once on the server with
# `dokku nginx:set meals client-max-body-size 5m` (README, "One-time server setup"). CI's browser
# tests save the largest recipe photo to this image, so a lower limit fails them (MEA-105).
ENV BODY_SIZE_LIMIT=5M
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY drizzle ./drizzle
COPY standard-images ./standard-images
COPY default-dish-photos ./default-dish-photos
COPY scripts/backup.js ./scripts/backup.js
COPY app.json ./
USER node
EXPOSE 3000
CMD ["node", "build"]
