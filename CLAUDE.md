# Meals

A SvelteKit 3 app (Svelte 5, TypeScript, SQLite through Drizzle) where households share a
grocery list, recipes and a dinner menu. [README.md](README.md) covers running, settings and
deploying. [docs/design.md](docs/design.md) is the approved design.

## Before pushing

Run what CI runs (`.github/workflows/deploy.yml`), and fix anything that fails:

```sh
npm run check      # types
npm test           # unit and database tests (Vitest)
npm run test:e2e   # browser tests (Playwright) against a production build
```

Install with `npm ci --ignore-scripts`. If Playwright's own Chromium isn't installed, point
`PW_CHROMIUM_PATH` at another Chromium (see `playwright.config.ts`).

A push to `main` deploys to production.

## The design is the source of truth

- `docs/design.md` describes how the app behaves. Read the section you're changing first.
- Code comments cite its section and decision numbers, for example "(6.11)" or "(Q28)".
- A change to behavior that design.md describes updates design.md in the same change.

## Code

- Routes never query the database. Household data goes through `src/lib/server/data/`, one
  module per area, and each function there that works on a household takes `householdId`
  first. Sign-in and sessions are in `src/lib/server/auth/`, photo files in
  `src/lib/server/photos.ts`. The `/healthz` check is the one route that touches the
  database itself.
- Form actions: check who's asking (`requireHousehold` from `src/lib/server/auth/guards.ts`),
  parse the form with a zod schema and `parseForm`, then run the change through `attempt`,
  which turns a 400 from the data layer into a message on the form. Both are in
  `src/lib/server/forms.ts`. Messages are shown to people as written.
- Routes import shared code as `#lib/...` (`package.json` imports).

## Database

Change `src/lib/server/db/schema.ts`, then run `npm run db:generate -- --name <what-changed>`
and commit the new files in `drizzle/`. Never edit files in `drizzle/` by hand. The app applies
migrations when it starts.

## Tests

- Unit and database tests are `*.spec.ts` files next to the code they test.
- Database tests start from `freshDb()` and `makeHousehold()` in `src/lib/server/testing.ts`.
- Browser tests are `tests/e2e/*.e2e.ts`. They sign in through the `person` fixture in
  `tests/e2e/fixtures.ts`, which writes a session straight into the test database, and
  set up data with its helpers (`addRecipe`, `addDinner` and others).
