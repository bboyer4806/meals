# meals.dev.boyersoftware.com

A website where households keep a shared grocery list, recipes and a dinner plan. Listed on
[dev.boyersoftware.com](https://dev.boyersoftware.com). The design, including what each phase
builds, is in [docs/design.md](docs/design.md).

Built with SvelteKit 3 and TypeScript, with a SQLite database stored on the server's disk.

## Running it locally

You need Node 24 and a Google OAuth client whose redirect URIs include
`http://localhost:5173/login/google/callback` (see [Google sign-in](#google-sign-in)).

```sh
npm ci --ignore-scripts
cp .env.example .env   # then fill in the values
mkdir data
npm run dev
```

Open http://localhost:5173 and sign in with the Google account in `ADMIN_EMAIL`. The first
sign-in asks you to set up your household.

## Checks

```sh
npm run check      # types
npm test           # unit and database tests
npm run test:e2e   # browser tests against a production build
```

The browser tests use Playwright's Chromium (`npx playwright install chromium`). They sign in by
writing a session straight into a throwaway database in `.e2e-data`, so the app has no test-only
way to sign in.

## Settings

The app reads these when it starts and refuses to start if one is missing. Building the image
needs none of them.

| Variable               | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | From Google Cloud Console                                             |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console                                             |
| `ADMIN_EMAIL`          | The Google account that can invite new households from `/admin`       |
| `DATA_DIR`             | An existing directory for the database (`/data` on the server)        |

## Google sign-in

One-time setup in [Google Cloud Console](https://console.cloud.google.com):

1. Create a project.
2. Set up the OAuth consent screen: External, app name "Meals", scopes `openid`, `email` and
   `profile`, publishing status "In production".
3. Create an OAuth client ID of type "Web application" with these redirect URIs:
   - `https://meals.dev.boyersoftware.com/login/google/callback`
   - `http://localhost:5173/login/google/callback`

## Deploying

Every push to `main` runs `.github/workflows/deploy.yml`. It runs the checks, builds the image on
GitHub, pushes it to GHCR, and has Dokku on the server run it as the app `meals`. The same run
creates the app if it is missing, sets its domain, mounts its storage at `/data`, sets its
settings, maps port 3000, and requests its first HTTPS certificate. The server renews it, as
described in the [dev repo's README](https://github.com/bboyer4806/dev#one-time-server-setup).
Pull requests run the checks only.

The repo needs these Actions secrets (Settings > Secrets and variables > Actions):

| Secret                 | Value                                                                 |
| ---------------------- | --------------------------------------------------------------------- |
| `DOKKU_SSH_KEY`        | the private deploy key whose public half is added to Dokku            |
| `DOKKU_HOST`           | `15.204.120.53`                                                       |
| `GOOGLE_CLIENT_ID`     | from Google Cloud Console                                             |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console                                             |
| `ADMIN_EMAIL`          | your Google account email                                             |

Dokku checks `/healthz` before it switches traffic to a new version. `app.json` sets that check
and the nightly backup.

## Backups

Every night at 03:00 server time, Dokku runs `node scripts/backup.js`. It copies the database to
`/var/lib/dokku/data/storage/meals/backups/<date>/meals.db` and keeps the newest 14. A failed
run leaves the existing backups alone.

Dokku sends the job's output only to the cron email address, not to `dokku logs`. Check the
Admin page instead: it shows the date of the newest complete backup, so a date that stops
moving means backups are failing.

The backups are on the same disk as the database, so they don't survive losing the server.

To restore one, on the server:

```sh
dokku ps:stop meals
cd /var/lib/dokku/data/storage/meals
# Remove the old write-ahead files first, or SQLite would apply them to the restored copy.
rm -f meals.db-wal meals.db-shm
cp backups/2026-10-03/meals.db meals.db
chown 1000:1000 meals.db
dokku ps:start meals
```

## Changing the database

Edit `src/lib/server/db/schema.ts`, then run `npm run db:generate -- --name <what-changed>` and
commit the new file in `drizzle/`. The app applies new migrations when it starts.
