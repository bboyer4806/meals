# Meals: design

Approved on 2026-10-03 with no changes. This doc records the decisions from our Q&A and
turns them into a data model, rules, screens and a build plan.

[Section 2](#2-beyond-the-qa) lists every place where the design changes, adds to or
fills in your answers, and you approved all of them. Your answers themselves are
recorded in [section 3](#3-decisions).

## 1. What we're building

A phone-first website where households manage three connected things:

- **Groceries:** a shared list of things to buy (groceries and household goods), each
  with a quantity, a store and a status (To Order, Ordered, Received). Every item
  remembers the store it was last bought from.
- **Recipes:** ingredients, steps, notes, a photo and nutrition. Recipes scale to any
  number of servings, with unit conversion.
- **Menu:** one dinner per day: cooking at home, eating out, bringing a dish, or
  leftovers. Dinners are made of dishes from the recipe collection. A pantry checklist
  built from the coming week's dinners shows what's needed, and anything missing goes
  onto the grocery list (hidden for now; 6.8).

Several households use the site, and each sees only its own data. Sign-in is with
Google and is invite-only.

## 2. Beyond the Q&A

### 2.1 Changes from what we discussed

1. **The Recipes page lists every dish.** In Q2 I said it would list only dishes with
   recipe details. Any rule for "has details" makes a recipe vanish from the list while
   you're still writing it. Instead every dish is listed, and dishes with no ingredients
   and no steps are labeled "No recipe".
2. **Checklist totals are shown in one unit.** The Q32c example said "1 cup + 2 tbsp".
   Totals use the same display rule as scaled amounts ("1 1/8 cups"), and each line
   lists the amount for each recipe underneath ("1 cup for Pound cake, Tue" and
   "2 tbsp for Pan sauce, Thu"), so the breakdown is still visible.
3. **Step warnings skip times and temperatures.** Q34 flags scaled steps that contain
   numbers. Without an exception, "Bake 25 to 30 minutes at 350°F" would be flagged in
   almost every recipe, and a warning that is always on gets ignored.

### 2.2 Additions (all kept)

1. **"Always have" on an item.** Items like water or salt are left off pantry
   checklists. Without this, water shows up on every checklist. Hidden for now with the
   pantry check (6.8).
2. **"Move to another date" on a dinner.** For "we didn't make Tuesday's dinner, let's
   do it Wednesday". A date's dinners move together (6.9); if the other date already has
   dinners, the two dates swap them. The date at the top of the page opens it (7).
3. **Received lines stay visible until the end of the day,** checked and struck
   through. Tapping one again undoes it. This handles mis-taps in a store.
4. **The Admin page shows the date of the last backup.** Nothing else would tell you
   that backups had stopped.

### 2.3 Details I filled in

Grocery list:

- Marking a line Ordered or Received requires a store. If it has none, you're asked
  which store. This keeps the default store (Q17) learning from every purchase.
- If you add an item that is already Ordered (but not To Order), the warning offers to
  add a new To Order line instead of changing an order you already placed.
- "Got fewer" also works for in-person shopping: you needed 3, the store had 2.
- Bulk actions ask first ("Mark 7 Walmart items as ordered?").
- The unit is pre-filled with the unit used the last time that item was added.
- The default store can't be edited directly. It only changes through use (Q17).
- Lines in a store group are sorted by item name.

Households and accounts:

- A household has a time zone, so "today" is right for the menu, the checklist and
  "received today". It's filled from the browser at setup and can be changed.
- After the first sign-in for a new household, a setup page asks for the household
  name, usual servings and time zone.
- Members can remove other members but not themselves. This prevents someone locking
  themselves out and prevents empty households.
- An invite must match the email address of the person's Google account. Case doesn't
  matter.

Recipes and menu:

- No metric units in the known list (Q32b listed US units only). "g" or "ml" work as
  custom units: they scale but don't convert.
- One amount per ingredient. Ranges like "2 to 3 cloves" go in the prep note.
- Copying a dinner copies its type and its dishes with their roles, not its note or
  servings. If the date already has dishes, you confirm replacing them.
- The most-made list groups dinners that have exactly the same dishes.
- Switching a dinner to Eating out or Leftovers removes its dishes, after confirmation.
- A dish created by name from the menu has no ingredients until you add some.
- Check marks in the cooking view aren't saved.
- Photos: one per recipe, resized on the phone before upload, visible only to your
  household.
- Item, dish and store names are unique within a household, ignoring case.

Backups:

- Nightly at 03:00 server time, kept for 14 days. Photos are included.

## 3. Decisions

| #     | Topic                  | Decision                                                                                                                                         |
| ----- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Q1    | Item catalog           | One catalog per household, used by the grocery list and by recipe ingredients. Typing suggests existing items first.                            |
| Q2    | Dishes and recipes     | One record. Recipe details are optional.                                                                                                         |
| Q3    | Reusing dinners        | No saved meals. You copy a past dinner instead.                                                                                                  |
| Q4    | Missing ingredient     | Added to the grocery list with quantity 1 and the recipe amount in the note.                                                                    |
| Q5    | Pantry checklist       | Built from a range of menu dates (default: the next 7 days), or from one recipe. The same ingredient is combined across recipes.                |
| Q6    | Inventory              | None.                                                                                                                                            |
| Q7    | Users                  | Multiple households, each seeing only its own data.                                                                                              |
| Q8    | Sign-in                | Google.                                                                                                                                          |
| Q8b   | New households         | Invite-only. You (the site admin) invite them.                                                                                                   |
| Q9    | Devices                | Phone first.                                                                                                                                     |
| Q10   | Offline                | Online only.                                                                                                                                     |
| Q11   | Updates                | Pages reload their data when opened or returned to. No live updates.                                                                            |
| Q12   | Framework              | SvelteKit, TypeScript, SQLite on a Dokku volume.                                                                                                 |
| Q13   | Backups                | Nightly, on the same server.                                                                                                                     |
| Q14   | Statuses               | To Order, Ordered, Received. In-person trips skip Ordered.                                                                                       |
| Q15   | Store integration      | None. The site is a list you work from.                                                                                                          |
| Q16   | Quantity               | A number plus an optional unit.                                                                                                                  |
| Q17   | Default store          | The store the item was last ordered or bought from.                                                                                              |
| Q18   | Store when adding      | Filled in from the item's default store.                                                                                                         |
| Q19   | Orders                 | No order records. Per-store "mark all" actions.                                                                                                  |
| Q20   | Order problems         | Missing or short items go back to To Order with the remaining quantity. Substitutions go in the note.                                           |
| Q21   | After Received         | Hidden from the list, kept as history.                                                                                                           |
| Q22   | Duplicates             | A warning offers to update the existing line.                                                                                                    |
| Q23   | Categories             | None. The list is grouped by store.                                                                                                              |
| Q24   | Stores                 | Each household manages its own, starting empty.                                                                                                  |
| Q25   | Item details           | A notes field. No prices.                                                                                                                        |
| Q26   | Dinner types           | Cooking at home, Eating out, Bringing a dish, Leftovers. All have a note; Cooking at home and Bringing a dish also have dishes.                  |
| Q26b  | Leftovers              | A note only, no link to the original dinner.                                                                                                     |
| Q27   | Calendar               | A week list. No month view.                                                                                                                      |
| Q27b  | Week start             | Sunday.                                                                                                                                          |
| Q28   | Servings               | Each dinner has a serving count, starting at the household's usual size. Recipes scale to it.                                                   |
| Q29   | Dish roles             | Main, Side, Dessert, Other, set per dinner.                                                                                                      |
| Q30   | Finding past dinners   | A most-made list and search by dish name.                                                                                                        |
| Q31   | Recipe extras          | A photo, ingredient sections, and nutrition.                                                                                                     |
| Q31b  | Nutrition fields       | Calories, protein, carbs and fat per serving, entered by hand.                                                                                   |
| Q32   | Scaled amounts         | Kitchen fractions, converted to friendlier units within volume or within weight.                                                                 |
| Q32b  | Units                  | A list of known US units, plus custom units that scale but don't convert.                                                                        |
| Q32c  | Checklist combining    | Amounts in different units are combined using conversion.                                                                                        |
| Q33   | Odd amounts            | No amount means no scaling. Counts show the exact fraction.                                                                                      |
| Q34   | Amounts in steps       | Scaled steps that contain numbers get a warning.                                                                                                 |
| Q35   | Checklist state        | Saved and shared within the household.                                                                                                           |
| Q36   | Cooking                | A cooking view and a print layout.                                                                                                               |
| Q37   | Importing from a URL   | A later phase.                                                                                                                                   |
| Q37b  | Existing data          | None. Starting fresh.                                                                                                                            |
| Q38   | Build order            | Groceries, then Recipes, then Menu.                                                                                                              |
| Q39   | Style                  | Warmer and food-themed.                                                                                                                          |
| E1    | Membership             | One household per person.                                                                                                                        |
| E2    | Roles                  | All members can do everything.                                                                                                                   |
| E3    | Deleting               | Archive instead of delete.                                                                                                                       |
| E4    | Deploy                 | The existing pipeline and domain.                                                                                                                |
| E5    | Invites                | By email address. The site sends no email.                                                                                                       |
| A1-A4 | Starting assumptions   | Dokku deploy (E4), TypeScript (Q12), a responsive website (Q9) and US units (Q32b) are all confirmed.                                           |

## 4. Architecture

### 4.1 Stack

| Part                   | Choice                                                                                 | Why                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| App                    | SvelteKit 3, Svelte 5, TypeScript in strict mode, adapter-node                         | One Node server renders pages and handles forms (Q12).             |
| Database               | SQLite through better-sqlite3                                                          | One file on the server's disk. No database server to run.         |
| Queries and migrations | Drizzle ORM and drizzle-kit                                                            | Typed queries. Migrations are SQL files kept in the repo.          |
| Sign-in                | Google OAuth with PKCE in about 60 lines of our own code; sessions in our own table     | Small, and no auth framework to learn (Q8). The `arctic` library first planned here is deprecated on npm. |
| Form validation        | Zod                                                                                    | Form input is untrusted, so it's checked when it arrives.          |
| Styles                 | Plain CSS with variables; fonts self-hosted through Fontsource                         | No CSS framework and no requests to other sites.                   |
| Tests                  | Vitest and Playwright                                                                  | See section 10.                                                    |
| Runtime                | Node 24 (the current long-term support version) in the `node:24-slim` Docker image     |                                                                    |

### 4.2 Hosting and deploy

The app stays a single container on Dokku at meals.dev.boyersoftware.com, deployed by
`.github/workflows/deploy.yml` on every push to `main` (E4). Changes:

1. **Checks before deploying.** A new check job runs the type check, unit tests and
   end-to-end tests on pull requests and on pushes to `main`. The deploy job needs it,
   so code that fails never deploys.
2. **One-time server setup.** The server limits which commands the deploy key can run, so
   these are done once on the server by hand (README, "One-time server setup"):
   - create a storage directory owned by uid 1000 (the image's `node` user) and mount
     it at `/data`
   - set the app's configuration (section 4.3)
   - map ports `http:80:3000` and `https:443:3000`, because the app listens on 3000
   - in Phase 2, raise nginx's upload limit to 5 MB for photos (nginx's default is 1 MB)
3. **`app.json` in the image** defines a health check on `/healthz`, which Dokku waits
   for before switching traffic to a new version, and the nightly backup job
   (section 4.4).
4. **Dockerfile:** a build stage (install and build) and a runtime stage (production
   dependencies, build output, migrations and the backup script). It installs with
   `npm ci --ignore-scripts`, since no dependency needs its install script (better-sqlite3
   ships prebuilt binaries). It runs as the `node` user and exposes port 3000. In Phase 2 it
   also sets `BODY_SIZE_LIMIT=5M` so the app accepts photo uploads (adapter-node's default is
   512 KB).

The placeholder `index.html` is removed. The README gains instructions for local
development, configuration, and restoring a backup.

### 4.3 Configuration

| Variable                                 | Value                                                                                       | Set by                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | From Google Cloud Console (section 9)                                                       | Once on the server |
| `ADMIN_EMAIL`                            | Your Google email. This account can invite new households.                                  | Once on the server |
| `DATA_DIR`                               | `/data`                                                                                     | Once on the server |
| `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | The Jira site that feedback goes to, and the Atlassian account and API token that create its tickets (7, Feedback) | Once on the server |

The app reads these when it starts, not when it's built, so building the image needs no
secrets. It refuses to start if any is missing or if `DATA_DIR` doesn't exist (a missing
storage mount). For local development the same variables go in an untracked `.env` file, with
`DATA_DIR=./data`.

No `ORIGIN` setting is needed: in SvelteKit 3, adapter-node builds the app's origin from the
`Host` header Dokku passes through, with `https`.

### 4.4 Storage and backups

```
/data/meals.db                        database (WAL mode, foreign keys on)
/data/photos/<key>.jpg                photo, longest side 1600 px
/data/photos/<key>-thumb.jpg          thumbnail, longest side 400 px
/data/backups/<YYYY-MM-DD>/meals.db   nightly copy of the database
/data/backups/<YYYY-MM-DD>/photos/    nightly snapshot of the photos
```

During a deploy, Dokku runs the old and new containers on the same database for a short time.
Every write transaction takes SQLite's write lock when it begins, so the two take turns
instead of one failing.

The nightly job (Dokku cron, 03:00 server time) runs in a one-off container of the app
with the same `/data` mount (Q13). It:

1. Copies the database with SQLite's online backup, which is safe while the app runs.
2. Hard-links every photo into the snapshot folder. Unchanged photos take no extra
   space, and a deleted or replaced photo survives in older snapshots.
3. Builds each snapshot in a temporary folder and moves it into place only when it's
   complete, so a failed run never replaces or hides a good snapshot.
4. Keeps the newest 14 snapshots.

Dokku sends a scheduled job's output only to the cron email address, so failures don't show
in `dokku logs`. The Admin page's "last nightly backup" date is how you notice: it counts
only complete snapshots, so it stops advancing when backups fail.

To restore, you stop the app, copy a snapshot's database and photos back into place,
and start it. The README will have the exact commands.

**Risk you accepted:** the backups are on the same disk as the data. If the server is
lost, so is everything. Moving backups off the server later is a small change.

### 4.5 Security

- **Household isolation in code.** Every household-owned row has a `household_id`. Data
  functions take the household ID from the signed-in session, never from the request.
- **Household isolation in the database.** References between household-owned rows use
  composite foreign keys on `(household_id, id)`, so the database rejects a row that
  points at another household's data, even if someone tampers with a form.
- **Photos** are served through a route that checks the photo belongs to the signed-in
  household.
- **Sessions** use a random token in an `httpOnly`, `Secure`, `SameSite=Lax` cookie, and
  only a SHA-256 hash of the token is stored. Sessions last 30 days and are extended when
  used. Signing out deletes the session.
- **Forms:** SvelteKit's origin check blocks cross-site form posts. All input is validated
  with Zod.
- **No raw HTML** from user input is ever rendered (no `{@html}`), and SvelteKit's
  built-in Content Security Policy is turned on.
- **Admin** is only the `ADMIN_EMAIL` account. It sees household names and member
  emails, not household data.
- **Importing from a link** (7) has the server fetch a web page, so a link could aim it at the
  server itself. Only http and https are fetched, and never from an address on this computer
  or a private or link-local network (such as 127.0.0.1, 10.0.0.1, 192.168.1.1, ::1, or the
  cloud's metadata service at 169.254.169.254). Every address a name resolves to is checked
  as the connection is made, so the name can't resolve to a public address for a check and a
  private one for the fetch. Redirects are followed one at a time, up to 5, each checked the
  same way. A fetch stops after 10 seconds or 5 MB.

### 4.6 Code layout

```
src/lib/                  used by browser and server; no database access
  amounts.ts              read "1 1/2", format kitchen fractions
  ingredient-text.ts      split "1 1/2 cups flour, sifted" into an ingredient's parts
  csv.ts                  read CSV files
  recipe-schema.ts        read a page's schema.org Recipe into the recipe editor's fields
  units.ts                known units, spellings, conversion, display ranges
  scaling.ts              scale one ingredient amount
  checklist.ts            combine ingredient amounts into checklist lines
  steps.ts                find numbers in steps that won't scale
  dates.ts                "today" and weeks in a time zone
  whats-new.ts            the releases listed on What's new, newest first
src/lib/server/
  config.ts               settings from the environment, checked at startup
  db/schema.ts            tables
  db/index.ts             connection, settings, migrations at startup
  auth/                   Google sign-in, sessions, invites
  data/                   one module per area: households, stores, items, needs,
                          dishes, dinners, requests, pantry. Every function takes
                          householdId first, except whats-new (a person's seen
                          release), which takes the person's id.
  photos.ts               save, delete and serve photos
  jira.ts                 create a feedback ticket in Jira
  recipe-page.ts          fetch a recipe's web page (4.5) and read its JSON-LD
src/routes/               pages and form actions; database access only through data/
drizzle/                  generated SQL migrations
scripts/backup.js         the nightly backup job
```

## 5. Data model

Conventions:

- IDs are integers. Timestamps are milliseconds since 1970, UTC. Calendar dates are
  `YYYY-MM-DD` text in the household's time zone.
- Every household-owned table has `household_id`. Household-owned tables that others
  point at also have a unique key on `(household_id, id)` for the composite foreign keys.
- `archived_at` is empty for active records (E3, section 6.10).

**households:** `name`, `default_servings` (the usual number of people, at least 1;
Q28), `time_zone` (an IANA name such as `America/Chicago`), `created_at`.

**users:** `household_id` (empty only until household setup is done), `google_sub`
(Google's permanent account ID, unique), `email` (unique, lowercase), `name`,
`created_at`, `whats_new_seen` (the date of the newest release they've seen on What's new;
empty until they first open it; section 7), `tour_seen` (when they finished or skipped the
first-time tour; empty until then; section 7). One household per person (E1).

**sessions:** `id` (SHA-256 of the token), `user_id`, `expires_at`.

**invites:** `email` (unique, lowercase), `household_id` (empty means "create a new
household"), `created_at` (E5).

**stores:** `name` (unique per household, ignoring case), `archived_at` (Q24).

**items:** `name` (unique per household, ignoring case), `notes` (brand, size; Q25),
`default_store_id` (the store it was last ordered or bought from; Q17), `always_have`
(addition 2.2.1), `archived_at`, `created_at` (Q1).

**grocery_needs** (lines on the list): `item_id`, `quantity` (more than 0), `unit`
(optional free text such as "bags"; Q16), `store_id` (required unless the status is To
Order), `status` (`to_order`, `ordered` or `received`; Q14), `note`, `created_at`,
`ordered_at`, `received_at`.

**dishes** (dishes and recipes are one table; Q2): `name` (unique per household,
ignoring case), `servings` (at least 1), `prep_minutes`, `cook_minutes`, `steps` (text,
one step per line), `notes`, `source` (a URL or a book), `photo_key`, `calories`,
`protein_g`, `carbs_g`, `fat_g` (per serving, all optional; Q31b), `tried` (whether the
household has made it; false until someone checks Tried it), `archived_at`, `created_at`,
`updated_at`.

**dish_tags:** `dish_id`, `tag` (one row per tag, unique per dish ignoring case).

**dish_ingredients:** `dish_id`, `position`, `section` (an optional heading such as
"For the sauce"; Q31), `amount` (optional, more than 0; Q33), `unit` (optional, and only
with an amount; a known unit code or custom text; Q32b), `item_id` (required; Q1),
`prep_note` (such as "diced").

**dish_ratings:** `dish_id`, `user_id` (who rated; one rating per person per dish; removing
them from the household empties it and keeps the rating in the average and count), `stars`
(1 to 5; section 7, "Recipe").

**dinners:** `date` (up to 5 per household and date, in the order added; 6.9), `label`
(set on every dinner of a date with more than one, and only then), `type` (`cook`,
`eat_out`, `going` or `leftovers`; Q26), `note`, `servings` (at least 1; Q28), `created_at`,
`updated_at`. A date with no row is not planned.

**dinner_dishes:** `dinner_id`, `dish_id` (unique per dinner), `role` (`main`, `side`,
`dessert` or `other`; Q29). Only `cook` and `going` dinners have dishes.

**dish_requests** (requests for a dish or a restaurant): `user_id` (who asked; removing them
from the household removes their requests), `kind` (`dish` or `restaurant`; requests made
before restaurant requests are `dish`), `name` (as typed, or the recipe's name when requested
from its page), `note`, `dish_id` (on a dish request, and only there: the recipe the name
matched when it was asked for, the one the request made, or the one whose page it was requested
from), `created_at` (6.12).

**pantry_checklists:** at most one per household (Q35). Either `start_date` and
`end_date` (from the menu), or `dish_id` and `servings` (from one recipe). `created_at`.

**pantry_marks:** `checklist_id`, `item_id` (unique per checklist), `state` (`have` or
`need`), `need_id` (the grocery line that a Need created; deleting that line also clears
the mark).

How they connect: a household has users, invites, stores, items, grocery lines, dishes,
dinners, requests and at most one checklist. A request points at the member who asked and, for
a dish, its recipe. A rating points at a dish and, until they're removed, the member
who rated it. A grocery line points at an item and a store. An
ingredient points at a dish and an item. A dinner has dishes through `dinner_dishes`. A
mark points at a checklist, an item and sometimes a grocery line.

## 6. Rules

### 6.1 Sign-in, households and invites

1. People sign in with Google (scopes `openid`, `email` and `profile`). Google must
   report the email as verified.
2. A known Google account is signed in, and its email and name are refreshed.
3. An unknown account is matched by email:
   - An invite to a household: the account joins that household (E5).
   - An invite for a new household, or the `ADMIN_EMAIL` account signing in for the
     first time: the account is created without a household and goes to the setup page
     (household name, usual servings, time zone).
   - No invite: an "invite-only" page shows the email they used, so whoever invited
     them can check the address.

   A used invite is deleted.
4. Members (all equal; E2) can invite by email, cancel invites, and remove other
   members. Inviting fails if the email already belongs to a member of any household or
   already has an invite. A removed member's account and sessions are deleted, and they
   can be invited again.
5. The admin invites new households from the Admin page, which also lists households and
   the last backup date. The admin is also a normal member of their own household.

### 6.2 Grocery line statuses

| From                | Action                                                     | Result                                                                                                 |
| ------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| To Order            | Check off in a store                                       | Received. A store is required, and it becomes the item's default store.                                 |
| To Order            | Mark ordered (one line, or "Mark all ordered" for a store) | Ordered. A store is required, and it becomes the item's default store.                                  |
| Ordered             | Check off, or "Mark all received" for a store              | Received.                                                                                              |
| Ordered             | Didn't come                                                | Back to To Order, keeping its store (Q20).                                                             |
| To Order or Ordered | Got fewer (enter the amount you got)                       | A Received line for that amount, and the original is To Order with the rest (Q20). A store is required. If the line was To Order, the store becomes the item's default store (6.3). |
| Received today      | Tap again                                                  | Back to Ordered if it had been ordered, otherwise To Order (addition 2.2.3).                           |

Lines that are To Order or Ordered can be edited (quantity, unit, store, note) or
deleted. Received lines leave the list, apart from "received today", and are kept as
history (Q21).

### 6.3 Default store

When a line leaves To Order (to Ordered or Received), its store becomes the item's
default store (Q17). When an item is added to the list, its default store is filled in,
unless that store is archived (Q18).

### 6.4 Adding to the list

- Typing an item name suggests existing, non-archived items: names that start with the
  typed text first, then names that contain it, most often added first within each. A
  name with no match offers "Add new item".
- Quantity starts at 1. The unit is pre-filled with the one used last time for that item.
- If the item already has a To Order line, a warning shows it ("Milk is already on the
  list: 2 gal at Walmart") and offers to update that line's quantity, pre-filled with the
  sum when the units match. If the item only has an Ordered line, the warning offers to
  add a new To Order line instead (Q22).

### 6.5 Amounts and units

- Amounts can be typed as `2`, `1.5`, `1 1/2`, `1/2` or `½`, and are stored as numbers.
- Known units (Q32b) and how much each holds:

  | Volume | Holds   | Weight | Holds |
  | ------ | ------- | ------ | ----- |
  | tsp    | 1 tsp   | oz     | 1 oz  |
  | tbsp   | 3 tsp   | lb     | 16 oz |
  | fl oz  | 6 tsp   |        |       |
  | cup    | 48 tsp  |        |       |
  | pint   | 96 tsp  |        |       |
  | quart  | 192 tsp |        |       |
  | gallon | 768 tsp |        |       |

- Common spellings map to known units ("teaspoons", "Tbsp", "tablespoon", "c", "cups",
  "ounces", "lbs", "pounds" and so on). Anything else is a custom unit (clove, can,
  pinch, g).
- Volume and weight are never converted into each other.
- An amount with no unit is a count ("3" eggs).

### 6.6 Scaling and display

- Scale factor = target servings ÷ the recipe's servings. The target is the recipe
  page's servings control, or the dinner's servings when the recipe is opened from a
  dinner (Q28).
- At the recipe's own servings, amounts show exactly as entered.
- Otherwise, known units are converted to the unit whose range contains the amount (Q32):
  - volume: tsp below 1 tbsp; tbsp from 1 tbsp up to 1/4 cup; cups from 1/4 cup up to
    1 gallon; gallons from 1 gallon
  - weight: oz below 1 lb; lb from 1 lb
  - pint, quart and fl oz are never picked automatically
- Numbers round to the nearest kitchen fraction: a whole number plus 1/8, 1/4, 1/3, 1/2,
  2/3 or 3/4. Anything above zero shows as at least 1/8.
- Custom units and counts are scaled and rounded the same way and keep their unit.
- Ingredients with no amount are never scaled (Q33).
- Checklist totals (section 6.8) always use the ranges above, because a total can combine
  several recipes. The per-recipe amounts listed under a total follow the rules above.

| Entered          | Scale  | Shown      |
| ---------------- | ------ | ---------- |
| 1/4 cup          | ×3     | 3/4 cup    |
| 1 tsp            | ×12    | 1/4 cup    |
| 1 tbsp           | ×16    | 1 cup      |
| 1/4 cup          | ×1/2   | 2 tbsp     |
| 1 lb             | ×1/2   | 8 oz       |
| 8 oz             | ×3     | 1 1/2 lb   |
| 1 quart          | ×2     | 8 cups     |
| 2 cloves         | ×1 1/2 | 3 cloves   |
| 1 (eggs, a count) | ×1 1/2 | 1 1/2     |
| salt (no amount) | any    | salt       |

### 6.7 Step warnings

When a recipe is scaled, a step is marked "amounts in this step aren't scaled" if it
contains a number. Numbers that are times or temperatures don't count: those followed by
°, degrees, minutes, min, hours, hr, seconds or sec, including ranges like "25 to 30
minutes" (Q34, change 2.1.3).

### 6.8 Pantry checklist

**Hidden for now.** The pantry check is too much functionality for the value it gives right
now, so nothing leads to it: no "Check pantry" on the menu or a recipe, no link in the More
menu, and `/pantry` and its actions are not found. It may come back, so its data and code
stay, and a household's check in progress stays stored. While it's hidden, the Items page
doesn't show or change Always have (addition 2.2.1), and grocery lines that Need added stay
on the list. The rest of this section describes it as built.

- A household has at most one checklist. It's shared by the household's members, and its
  check marks are saved (Q35).
- It's started from the menu with a date range (default: today through 6 days from
  today; Q5), or from a recipe at the servings shown. Starting a new one replaces the
  current one, after confirmation if anything is checked. "Start over" clears the marks.
- The lines are worked out from the current menu and recipes each time the checklist
  opens, so menu changes show up. Marks are stored per item.
- There's one line per item. Each line shows a total for each kind of amount: volume,
  weight, each custom unit, counts, and "no amount" (Q32c). Under the totals, the amount
  for each dish and day.
- Items marked Always have are left out (addition 2.2.1).
- Items with a To Order or Ordered line show "On list" with the status, and need no
  action.
- Every other line has **Have** and **Need**. Need adds a grocery line right away (Q4):
  quantity 1, the item's default store, and a note such as "1 1/8 cups for Pound cake
  (Tue), Pan sauce (Thu)". Undoing Need deletes that line if it's still To Order.
- Dishes in the range with no ingredients are listed at the bottom ("Rolls, Tue") so they
  aren't forgotten.
- Eating out and Leftovers dinners add nothing.

### 6.9 Dinners and reuse

- A date has one dinner unless someone adds another (MEA-5), such as one for the kids and
  one for the adults, up to 5. Each has its own type, note, servings and dishes. The types are
  Cooking at home, Eating out, Bringing a dish and Leftovers. All have a note. Cooking at home
  and Bringing a dish also have dishes and servings (Q26).
- A dinner has a label only when its date has more than one, and then every dinner on it
  needs one: up to 30 characters, unique within the date ignoring case. Adding the second
  dinner asks for both labels. When clearing leaves one dinner, its label is removed. A new
  dinner starts as Cooking at home with the usual servings, an empty note and no dishes.
- Servings start at the household's usual number (Q28).
- A date with no dinner shows Cooking at home, with the usual servings and an empty note,
  without saving it. The date stays not planned until a dish, a copy, a type or Save plans it.
- Every dish in a dinner has a role. The first dish added defaults to Main and later ones
  to Side. Dishes are listed Main, Side, Dessert, Other (Q29).
- **Copy a dinner** (Q3, Q30): the picker groups all dinners that have dishes by their
  exact set of non-archived dishes. Each group shows its dishes, how many times it was
  made, and when it was last made. The most-made groups are listed first. Typing filters
  to groups with a dish whose name matches, most recent first. Copying sets the type and
  the dishes with their roles. Each dinner counts on its own, so a date with Kids and Adults
  dinners counts as one make for each.
- **Move to another date** (addition 2.2.2) moves all of a date's dinners, and swaps them
  with the other date's if it has any; a date's dinners can't be moved separately. Tapping
  the date at the top of its page opens it (7). On a computer, dragging a day onto another in
  the week view does the same (7, Menu).

### 6.10 Archiving

Stores, items and dishes are archived instead of deleted (E3). Archiving hides a record
from pickers, suggestions and default lists (the Items and Recipes pages have a "show
archived" switch). Everything that already uses it keeps working: past dinners, recipes,
history, and lines on the list. It can be restored at any time. Its name stays taken, so
adding the same name offers to restore it.

### 6.11 Freshness

Every page reloads its data when opened and when you come back to the tab or app (Q11).
If two people change the same thing, the last save wins.

### 6.12 Requests

- Anyone in the household can ask for a dish or a restaurant, see every request and remove any
  of them (E2). Requests are listed oldest first, dish and restaurant requests together, each
  with the dish (or "Eating out" and the restaurant), the note if there is one, and "Asked by"
  with the asker's name. Showing who asked is an exception to section 12, for requests only.
- The dish field suggests the household's active dishes and offers a new one, like adding a
  dish to a dinner (6.9). Every dish request links to a recipe. A name that matches an active
  dish, ignoring case, links to it. Any other name adds a dish to Recipes with that name and the
  household's usual servings, labeled "No recipe", and links to it. A name that matches an
  archived dish asks "Chili is archived. Restore it and request it?" with **Restore it and
  request**, which restores it and adds the request, and **Cancel**, which adds nothing (6.10).
- A recipe's page also has **Request** (MEA-41; section 7, "Recipe"), which adds a request for
  that recipe from the signed-in person, linked to it, named as the recipe is named then, with
  no note. A recipe with any request, from either place, shows "Requested" in its place, and
  shows Request again once its requests are removed. Tapping Request after someone else
  requested the recipe adds nothing, so the page never adds a second request; the Menu's sheet
  still can. An archived recipe has no Request.
- The link is set when the request is made and never changes: a request keeps it, and its
  name, after the recipe is renamed or archived. Removing a request leaves its recipe in
  Recipes.
- Requests made before every request had a recipe were linked once, when that change was
  deployed: to the dish with the name, ignoring case, if there was one (an archived one stayed
  archived), and otherwise to a new one made as above. Requests with the same name shared one
  new dish, spelled as the oldest request typed it.
- A restaurant request (MEA-49) asks to eat out, at a restaurant typed by name, with no
  suggestions. Restaurants aren't kept anywhere, and an Eating out dinner has no restaurant
  (Q26), so the request links to nothing: it shows "Eating out" and the name as typed. Requests
  made before restaurant requests are dish requests.
- The dish or restaurant name is required and up to 80 characters; the note is optional and up
  to 200. Each field stops taking characters at its limit, pasted text included, and says so
  while it's full. The server refuses anything longer (4.5).
- Requests have no statuses, dates or link to dinners. One stays until someone removes it,
  without being asked first. Removing a member removes their requests.

## 7. Screens

On a phone, tabs at the bottom switch between **Groceries**, **Menu** and **Recipes**. A
header menu, More, holds Items, History, Household, What's new, Admin (admin only) and Sign
out. Help sits in the header to the left of More.

| Screen           | Path                                 | What it does                                                                                                                         |
| ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Sign in          | `/login`                             | "Sign in with Google".                                                                                                               |
| Invite-only      | `/not-invited`                       | Shown to an account without an invite, with the email it used.                                                                      |
| Household setup  | `/setup`                             | First sign-in for a new household: name, usual servings, time zone.                                                                 |
| Grocery list     | `/groceries`                         | See below.                                                                                                                           |
| History          | `/groceries/history`                 | "‹ Groceries", then received lines by date, newest first, searchable by item.                                                        |
| Items            | `/groceries/items`                   | "‹ Groceries", then the catalog: rename, notes, archive and restore. Shows each item's default store and when and where it was last bought. |
| Recipes          | `/recipes`                           | Search by name, filter by tag, sort by name or rating (see below), photo thumbnails, total time, the "No recipe" label, the household's rating ("★ 4.5 (2)") in the upper right of rated recipes, a "Tried" badge in the bottom right of tried recipes, Import and New recipe. |
| Import recipes   | `/recipes/import`                    | See below.                                                                                                                           |
| Recipe           | `/recipes/[id]`                      | See below.                                                                                                                           |
| Edit recipe      | `/recipes/new`, `/recipes/[id]/edit` | See below.                                                                                                                           |
| Cooking view     | `/recipes/[id]/cook`                 | Large text, the screen stays on, and you tap ingredients and steps to check them off (Q36).                                          |
| Menu             | `/menu`                              | See below.                                                                                                                           |
| Dinner           | `/menu/[date]`                       | See below.                                                                                                                           |
| Pantry checklist | `/pantry`                            | Section 6.8. Hidden for now: nothing leads to it, and the page is not found.                                                         |
| Household        | `/household`                         | Name, usual servings and time zone; members; invites; stores.                                                                        |
| What's new       | `/whats-new`                         | See below.                                                                                                                           |
| Admin            | `/admin`                             | Invite households, list households, last backup date.                                                                                |

**Feedback.** Every screen after household setup, from Grocery list to Admin, has a round
"Send feedback" button with a speech-bubble icon at the bottom right, just above the tab bar.
Pages leave room at the end so it never covers their last row, and printing hides it. It opens
a "Send feedback" sheet with a Feedback box of up to 2,000 characters, a count such as
"120 / 2,000" ("You've reached the 2,000-character limit." at 2,000), and Send. An empty box
says "Enter your feedback". While sending, Send reads "Sending…" and can't be tapped again.
Sending creates a Task in the MEA backlog, labeled `user-feedback`, titled "Feedback: " and the
first 80 characters of the message's first line. Its description has the message, the page's
path and query, the sender's name and email, the household's name, the browser's user agent and
the window size. The sender and household come from the session. The app's server creates it
with Jira's API and the `JIRA_*` settings (4.3), so the token never reaches the browser and the
ticket's reporter is that token's account. The sheet then says "Thanks, your feedback was
sent." The page behind isn't reloaded, so anything typed there and not saved stays. If Jira
can't be reached or refuses the ticket, it says "Couldn't send your feedback. Try again." and
keeps the message. Feedback isn't stored in the app.

**Help.** Every screen after household setup, from Grocery list to Admin, has a Help button in
the header to the left of More, which printing hides with the rest of the header. It opens a
sheet titled "Help: " and the screen's name, such as "Help: Grocery list", that says what the
screen is for and how to do its main tasks, in plain words and no more than about 6 short points.
Recipe, Edit recipe (and New recipe, which shares its form and adds a point about Import from a
link), Import recipes, Cooking view, Dinner, History and Items each have their own help. The
sheet closes with ✕, Escape or a tap on the backdrop.
Opening it changes nothing on the page behind, so anything typed there and not saved stays. The
help is fixed text in `src/lib/help.ts`, keyed by each screen's route, and the type check fails
if a screen has none. It opens only when asked: there's no Help page or link in More, and the
first-time tour (below) only points at it.

**Tour.** The first time each person opens the Grocery list, a short tour steps through the
controls they'll use most: Groceries, Menu, Recipes, More, Help and Send feedback, in that order.
That includes new people after their first sign-in, whether they set up a household or were
invited (6.1), and everyone already using Meals when the tour arrived, since their `tour_seen`
starts empty. It's per person, not per household, and the same for admins. Each step outlines
its control, dims the rest of the screen and shows a card with its place, such as "1 of 6", the
control's name, one line about it, Skip and Next; the last step has Done in place of Next. While
it shows, the page behind can't be tapped, and screen readers announce each step. Done, Skip or
Escape records `tour_seen`, so it never shows again on any device. Reloading or leaving the
Grocery list before then records nothing, and the tour starts again from the first step the
next time. There's no way to replay it, and no other screen has a tour.

**Grocery list.** An add bar at the top: item (with suggestions), quantity, unit, store
(filled from the default; tap to change) and Add. Below it, one group per store plus "No
store". Groups can be collapsed, and the device remembers which ones are. Each group
lists its To Order lines, then Ordered, then Received today (struck through). Store
groups have "Mark all ordered" and "Mark all received"; "No store" has neither. A row's
circle checks it off as Received. Tapping a row opens an edit sheet: quantity, unit,
store, note, Mark ordered, Didn't come, Got fewer, and Delete. An item's notes (brand,
size) show under its name.

**Search.** Recipes, History and Items search as people type (MEA-36): the list updates 300 ms
after typing stops, and Enter, or a phone keyboard's search key, searches right away. There's no
Search button. The box keeps focus while the list updates, so a phone's keyboard stays open, and
what's typed meanwhile stays in the box, spaces included. Clearing the box shows the list with no
search. Each list keeps its search in the address, so Back and shared links keep it, but typing
replaces the address instead of adding Back steps: Back from a searched list leaves the list, and
Back from a recipe opened from a search returns to that search. A search box only matches what
its list already matched; there are no suggestions under it.

**Recipes.** A **Sort** dropdown beside the search box offers **Name** (A to Z, the default) and
**Rating** (highest first). Choosing one reorders the list right away, and like the search adds no
Back step.
Rating uses the household's exact average, not the rounded one shown; unrated recipes go last,
and equal averages fall back to name. The sort, search, tag and archived switch are kept in the
address, so Back and shared links keep them, and changing any one keeps the others; "Show all
recipes" clears the search and tag. An unknown sort shows Name. Opening Recipes from the tab
bar or "‹ Recipes" starts at Name.

**Import recipes.** Households bringing recipes from elsewhere (MEA-37; Q37b assumed none) add
many at once from a CSV file saved from a spreadsheet. Import beside New recipe opens it, with
"‹ Recipes", Download template, a file field, Import and Cancel; its Help explains the layout.
The template is the header row alone: Recipe, Servings, Prep (min), Cook (min), Tags,
Ingredients, Steps, Notes, Source, Calories, Protein (g), Carbs (g), Fat (g). Columns are
matched by name ignoring case, in any order; only Recipe is needed, and other columns are
ignored. Each row is one recipe, and blank rows are skipped. Ingredients and Steps hold several
entries separated by `|`, and an ingredient entry starting with `#` is a section heading. Each
ingredient entry fills an editor row (`src/lib/ingredient-text.ts`): an amount, or a range whose
first amount is the amount and which goes in the prep note as "2 to 3"; then a known unit (6.5)
or a common one, such as clove, can, pinch, slice or stick, while any other word starts the
item; then the item up to the first comma, and the rest as the prep note. "1 1/2 cups flour,
sifted" is 1 1/2, cup, flour and sifted; "Salt, to taste" has no amount. Fields follow the
editor's rules and limits, tags are separated by commas, and a blank Servings is the
household's usual servings. If anything is wrong, nothing is imported, and the page lists each
problem with its row number (the header is row 1), such as "Row 7: enter an amount like 1 1/2."
Problems include a missing Recipe column, a row without a name, a name used twice in the file
("Row 5: Pound cake is also on row 2."), an ingredient the editor wouldn't take ("Row 7: '2 cups'
needs an item.") and an archived item ("Row 9: Saffron is archived. Restore it on Items first."),
since importing never restores items. A file with no problems whose recipe names are already in
Recipes (ignoring case, archived included) first lists those recipes, archived ones marked so,
each with Skip (selected to start), Replace and Rename. Skip leaves the file's recipe out.
Replace swaps the existing recipe's details for the file's, keeping its name, photo, Tried,
ratings, dinners and archived state. Rename imports the file's recipe under a name typed there, which no
recipe or other row may have. The chosen file stays in the form and is sent again with the
choices; nothing is kept between the two. The whole import is checked and saved in one
transaction. Recipes then says what it did until the next navigation, such as "Imported 9
recipes, replaced 2 and skipped 3. Ignored columns: Step and Rating.", leaving out the parts that
are 0 or empty. New item names join the catalog, as from the editor.

**Recipe.** "‹ Recipes" goes to the Recipes list with no search or filters, sorted by name,
even when the recipe was opened from a dinner. Photo, name, tags, a **Tried it** checkbox, your
rating, prep, cook and total time, and a servings control (plus and minus). Tried it saves as soon as
it's tapped, with no Save button, and is shared by the household (6.11); Edit recipe leaves it
as it was, and it works the same on archived recipes. Your rating is five stars under Tried
it, your own and nobody else's: tapping a star saves it right away, and tapping your current
star again clears it. Beside the stars is the household's average, rounded to the nearest half
star, with the number of ratings, such as "★ 4.5 (2)", and no names. A removed member's ratings
stay in it. Rating doesn't change Tried it, and works the same on archived recipes. Under the
stars, **Request** asks for the dish on the Menu's Requests (6.12), on any recipe that isn't
archived, "No recipe" ones included. It saves as soon as it's tapped, and the page stays at the
servings shown. A recipe with any request says "Requested" in its place. Ingredients grouped by section and scaled (section
6.6), numbered steps with warnings when scaled (6.7), notes, source (a link when it's a
URL), and nutrition per serving. Actions: Cook, Print, Edit, Archive ("Check pantry" is
hidden for now; 6.8). Print uses a print layout of this page at the current servings,
without buttons, Tried it, ratings, "Requested" or navigation (including "‹ Recipes").

**Edit recipe.** Name, photo (take or choose; resized on the phone), servings
(pre-filled with the household's usual number for a new recipe), prep and cook minutes,
tags (with suggestions), ingredients, steps (one per line in a single text box), notes,
source, and nutrition. Each ingredient row has an amount, a unit (pick a known unit or
type your own), an item (with suggestions, or a new one) and a prep note. Rows move with
up and down buttons, and "Add section" inserts a heading.

**Import from a link.** New recipe has a Link field and Import above the editor (MEA-47, Q37),
so a recipe found online can be brought in on any device, a phone included. Most recipe sites
put a schema.org Recipe in their pages as JSON-LD for search engines; Import has the server
fetch the page (4.5) and fills in the editor from it: the name, servings, prep and cook minutes,
ingredients, steps one per line, calories, protein, carbs and fat, with Source set to the link.
Servings are the first whole number in the page's yield, such as 4 in "4 servings". Each
ingredient is split as Import recipes splits one, so "1 1/2 cups flour, sifted" is 1 1/2, cups,
flour and sifted. Steps grouped in sections keep their order without the section names, and
HTML and character references such as `&amp;` are taken out of the text. Fields the page leaves
out keep what a new recipe starts with, such as the household's usual servings; the photo, tags
and notes are never imported. The page then says "Filled in from the page. Check it, then tap Save."
Nothing is saved until Save, which checks the fields as if they were typed. A page without a
Recipe says "Couldn't find a recipe on that page.", and one that can't be opened says
"Couldn't open that page. Check the link and try again."; either way the link stays in its
field and the editor stays as it was. The link must start with http:// or https:// and, like
Source, be up to 500 characters. Pages whose sites block servers or need a sign-in can't be
opened, and recipe data written as Microdata or RDFa rather than JSON-LD isn't read.

**Menu.** Sunday to Saturday (Q27b), one row per day: the date, type, dishes by role,
and note. A day with more than one dinner shows each one (label, type, dishes by role, note)
in the order they were added. Today is highlighted. Previous, next and "This week" buttons. Tapping a day
opens its dinner. With a mouse or trackpad, dragging a planned day onto another day of the week
works like Move to another date (2.2.2, 6.9): the two days swap their dinners, and the week stays
open. The day under the pointer is outlined while dragging; "Not planned" days can't be dragged,
and releasing on the same day or outside the days changes nothing. Touch never drags, so tapping
still opens a day and swiping scrolls. If someone cleared or moved the dragged day's dinners
since the week loaded, nothing moves, the week shows the menu as it is now, and it says "Someone
cleared or moved that day's dinners, so nothing moved." ("Check pantry" is hidden for now; 6.8.) Under the week, on every week,
**Requests** lists the dish and restaurant requests together (6.12), or "No requests yet.", each
with Remove. "Request a dish" opens a sheet with Dish (with suggestions, or a new dish), an
optional Note and Request. "Request a restaurant", beside it, opens a sheet with Restaurant, an
optional Note and Request, and the week shown stays open. Each dish request links to its recipe;
a restaurant request shows "Eating out" and the restaurant's name, not a link.

**Dinner.** "‹ Week of" goes to the dinner's week. Type (four buttons), note, servings,
and dishes. You add a dish by searching existing dishes or typing a new name, then picking
its role. Each dish links to its
recipe at this dinner's servings. Actions: Copy a dinner and Clear. A date with more than one
dinner shows them all on its one page, in the order they were added, each with its own label
(as a heading, and a Label field saved with its servings and note), type, dishes, servings,
note, Copy a dinner and Clear; changing one never changes another (6.9). A planned date has
**Add a dinner** until it has 5. On a planned date,
the date at the top is a button, with an icon, that opens Move to another date; on a date
with no dinner it's plain text. A date with no dinner says "Not planned yet" and shows Cooking
at home selected, with its servings and note ready to fill in, unsaved (6.9). The type, dishes,
copying, moving and clearing save as soon as they're made, and keep anything typed in the
servings and note for Save. Save on the servings and note goes to the dinner's week, where that
dinner's line says "Saved" for 3 seconds; on a date with no dinner it plans it as the type
shown. Leaving with something typed asks first. If someone cleared or moved the dinner
meanwhile, Save plans the date again when it has no dinner left, and the page stays to say so
(6.11).

**What's new.** What each release changed, newest first, in words for the people using the
app; every household sees the same page. Each release's heading is its version, such as "1.2"
for the "Meals 1.2" sprint, then "Released" with its date and one line per change people will
notice. Internal changes, such as tests or instruction files, aren't listed, and the page never
says "sprint". Releases live in `src/lib/whats-new.ts`, and when a sprint closes, one pull
request adds its release. When the newest release's date is later than both the person's
`whats_new_seen` and the day their account was created (in the household's time zone), a dot,
read by screen readers as "new", shows on More and on What's new. Opening the page records the
newest release as seen, which clears the dot on every device. Releases on the same day share a
date, so someone who saw the earlier one gets no dot for the later one (MEA-25). The link doesn't preload on
hover, as that would run the page's load and clear the dot without anyone opening it.

## 8. Look and feel

Warmer and food-themed (Q39), following the phone's light or dark setting:

- Colors: a warm cream background, dark brown text, tomato red for main actions, herb
  green for Received and Have, and mustard for Ordered. Final values are checked for
  contrast (WCAG AA) in both light and dark.
- Type: Fraunces, a soft serif, for headings, and Nunito, a rounded sans serif, for
  everything else. Both are self-hosted.
- Phone details: tap targets at least 44 px, edit sheets that slide up from the bottom,
  and nothing that depends on hovering.

Colors and fonts are defined once as variables, so changes after you see the first
deploy are quick.

## 9. Build plan

There are three phases (Q38). Each is its own pull request and goes live when merged.

### Phase 1: Foundation and Groceries

**One-time setup you do first:**

1. In Google Cloud Console:
   - create a project
   - set up the OAuth consent screen: External, app name "Meals", scopes `openid`,
     `email` and `profile`, publishing status "In production" (Google doesn't require
     app verification for these basic scopes)
   - create an OAuth client ID of type "Web application" with these redirect URIs:
     - `https://meals.dev.boyersoftware.com/login/google/callback`
     - `http://localhost:5173/login/google/callback`
2. On the server, run the one-time setup in the README: storage, settings and ports.

**Build:** project setup, Dockerfile, deploy workflow changes, `app.json`, database and
migrations, sign-in, invites, household setup, the Household and Admin pages, stores,
items, the grocery list, history, backups, and the look and feel.

**Done when:**

- Signing in with `ADMIN_EMAIL` leads to household setup and then the grocery list.
- An account without an invite sees the invite-only page.
- You can invite a family member by email. They sign in and see the same list.
- You can invite a new household from Admin, and neither household can see the other's
  data.
- Stores can be added, renamed, archived and restored.
- Adding an item fills in its last store, warns about duplicates, and adds new names to
  the catalog.
- Lines can be marked ordered and received one at a time or per store. Didn't come and
  Got fewer work. History shows received lines.
- Undoing a line received today works.
- A nightly backup appears, and Admin shows its date.
- A failing check stops a deploy.

### Phase 2: Recipes

**One-time setup you do first:** on the server, raise nginx's upload limit with
`dokku nginx:set meals client-max-body-size 5m`, then `dokku proxy:build-config meals`.

**Build:** recipes with every field in section 5 (sections, units, tags, nutrition, a
photo and thumbnail), the servings control with conversion and fractions, step warnings,
the cooking view, the print layout, archiving dishes, the pantry checklist from a single
recipe, Always have, and the app's larger upload limit (`BODY_SIZE_LIMIT`).

**Done when:**

- A recipe with sections, a photo and nutrition can be created on a phone, edited and
  archived.
- Changing servings shows amounts converted as in section 6.6, and steps with amounts
  show the warning.
- The cooking view keeps the screen on, and Print shows a clean page.
- "Check pantry" on a recipe lists its ingredients. Need adds an item to the grocery
  list with quantity 1, its default store and a note. Items already on the list show "On
  list".

### Phase 3: Menu

**Build:** the week view, the dinner editor, creating dishes by name, roles, servings,
Copy a dinner, Move to another date, links to recipes at a dinner's servings, and the
date-range pantry checklist with combined amounts and the reminders for dishes with no
ingredients.

**Done when:**

- A week can be planned using all four dinner types, with dishes and roles.
- Copy a dinner finds past dinners through the most-made list and by searching a dish
  name.
- Move swaps two dinners.
- The checklist for the next 7 days combines the same ingredient across recipes, scaled
  to each dinner's servings, and lists dishes that have no ingredients.

## 10. Testing

- **Unit tests (Vitest)** for the logic in `src/lib`: reading and formatting amounts,
  unit conversion, scaling, checklist totals, step warnings, and dates in a time zone.
- **Data tests (Vitest)** against a temporary database built from the real migrations:
  status changes and default stores, duplicates, Got fewer, invite and sign-up rules,
  rejection of cross-household references, Copy a dinner grouping, and checklist marks
  and the lines they create.
- **End-to-end tests (Playwright, Chromium, phone-sized screen)** for the main flow of
  each phase. Tests sign in by writing a session straight into the test database, so the
  app has no test-only way to sign in.
- All of them run on pull requests and before every deploy.

## 11. Problems people may hit, and how the design handles them

| Problem                                                          | Handling                                                                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Milk" and "milk" become two items                               | Suggestions come first, and names are unique ignoring case. Variants like "2% milk" can still be created; merging items is in section 12.          |
| A recipe amount isn't something you can buy                      | Quantity 1, with the recipe amount in the note (Q4).                                                                                                |
| The same ingredient is in several recipes in different units     | Combined by converting within volume or within weight. Other units are listed side by side (Q32c).                                                 |
| A one-off trip changes an item's default store                   | The next order corrects it (Q17).                                                                                                                   |
| A mis-tap in the store                                           | Received today stays visible; tap again to undo (2.2.3).                                                                                            |
| An order arrives short or missing                                | Got fewer and Didn't come (Q20).                                                                                                                    |
| Two people add the same item                                     | Duplicate warning (Q22).                                                                                                                            |
| Deleting a dish would break past dinners                         | Archive instead (E3).                                                                                                                               |
| Water shows up on every checklist                                | Always have (2.2.1).                                                                                                                                |
| Steps mention amounts that don't scale                           | A warning on those steps (Q34).                                                                                                                     |
| 1 1/2 eggs                                                       | Shown as a fraction; you decide (Q33).                                                                                                              |
| Large phone photos                                               | Resized on the phone before upload.                                                                                                                 |
| Someone signs in with a different address than the one invited  | The invite-only page shows the address they used.                                                                                                   |
| "Today" is wrong late at night                                   | The household's time zone decides the date.                                                                                                         |
| The server's disk fails                                          | Everything is lost (Q13). Moving backups off the server is in section 12.                                                                          |
| A deploy runs migrations while the old version is still serving  | For a few seconds the old version may show errors. Acceptable at this size.                                                                        |

## 12. Not in v1

- Importing a recipe's photo from its page, or a recipe from a site that blocks servers or
  needs a sign-in (Q37; Import from a link covers the rest).
- Backups off the server (Q13).
- Merging duplicate items.
- Showing who added or changed something, except who asked for a request (6.12).
- Deleting a household.
- Different servings for different dishes in the same dinner.
- Metric units in the known list.
- Decided against: store integrations (Q15), offline use (Q10), live updates (Q11),
  categories (Q23), prices (Q25), inventory (Q6) and saved meals (Q3).
