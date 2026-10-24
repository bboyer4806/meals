# Meals

A SvelteKit 3 app (Svelte 5, TypeScript, SQLite through Drizzle) where households share a
grocery list, recipes and a dinner menu. [README.md](README.md) covers running, settings and
deploying. [docs/design.md](docs/design.md) is the approved design.

## Development

Use Node 24, matching README, CI and Docker; `package.json` declares a minimum of 22.17.
Install with `npm ci --ignore-scripts`. Follow [local setup](README.md#running-it-locally)
to copy `.env.example` to `.env`, fill in the settings and create the `DATA_DIR` directory.
Manual development needs a Google OAuth client. Start with `npm run dev`.
`npm run build` builds the app without runtime secrets.

## Checks before pushing

Run the checks from `.github/workflows/deploy.yml`:

```sh
npm run check      # types
npm test           # unit and database tests (Vitest)
npm run test:e2e   # browser tests (Playwright), including a production build
```

Fix regressions caused by your change; report unrelated baseline failures and blocked checks.
Install browser-test Chromium with `npx playwright install chromium`, or set
`PW_CHROMIUM_PATH` to an existing compatible Chromium (see `playwright.config.ts`).
The browser suite recreates disposable `.e2e-data`, supplies test OAuth settings and creates
sessions directly; it needs no real Google sign-in or test-only authentication endpoint.
Its startup command uses `rm -rf` and `mkdir`; on Windows, add Git for Windows' `usr/bin`
to the test process's `PATH`. Keep real data out of `.e2e-data`.

## The design is the source of truth

- Read the relevant section of `docs/design.md` before changing the behavior it describes.
- Code comments cite relevant section and decision numbers, for example "(6.11)" or "(Q28)".
- Update design.md in the same change when its documented behavior changes.

## Code

- Protected loads and actions each call the appropriate `requireUser`, `requireHousehold`
  or `requireAdmin` from `src/lib/server/auth/guards.ts`; layout checks do not protect actions.
  Derive household identity from the signed-in session, never from request input.
- Household data goes through `src/lib/server/data/`, one module per area. Operations on
  household-owned data take `householdId` first; household creation, administrative
  listing and a person's What's new seen date have different signatures. Preserve household
  isolation in reads and writes.
- Routes use that data layer rather than querying the database. Sign-in and sessions live
  in `src/lib/server/auth/`, photo files in `src/lib/server/photos.ts`. The `/healthz`
  database check is the direct-query route exception.
- Simple form actions use a zod schema and `parseForm`, then `attempt` for synchronous data
  changes; both helpers are in `src/lib/server/forms.ts`. Data-layer HTTP 400s become form
  messages, shown to people as written. Recipe/photo saves use the specialized async
  `saveRecipe` in `src/lib/server/recipe-form.ts`; do not force them through `attempt`.
- Routes import shared code as `#lib/...` (`package.json` imports).

## Database

Change `src/lib/server/db/schema.ts`, then run `npm run db:generate -- --name <what-changed>`
and commit the new files in `drizzle/`. Never edit generated migrations by hand. A data change
the schema can't express goes in a custom migration: run `npm run db:generate -- --custom --name
<what-changed>` and write its SQL in the empty file it makes, matching names with `fold()`. The
app applies migrations when it starts. Use the existing `transaction()` helper in
`src/lib/server/db/index.ts` for grouped writes; its immediate lock handles overlapping deploys.

## Tests

- Unit and database tests are colocated `*.spec.ts` files under `src/` and `scripts/`.
- Database tests use `freshDb()` and `makeHousehold()` in `src/lib/server/testing.ts`;
  `freshDb()` opens an in-memory database through the real migration path.
- Browser tests are `tests/e2e/*.e2e.ts`. Use the `person` fixture in `tests/e2e/fixtures.ts`
  for sessions and its helpers (`addRecipe`, `addDinner` and others) to set up data.

## Workflow

When a sprint closes, one pull request adds its release to the top of `src/lib/whats-new.ts`:
the sprint's version ("Meals 1.2" is "1.2"), the date it closed, and one line per change
people will notice, written for them. Leave out internal changes, such as tests or instruction
files. See design.md section 7 (What's new).

A push to `main` deploys to production, including documentation-only changes. PRs run checks
only. Keep setup, deployment, backup and OAuth details in README, and behavior details in
design.md; consult the relevant section for the task. Update this file alongside changes to
the commands or conventions it describes. `CLAUDE.md` imports this shared guidance.
