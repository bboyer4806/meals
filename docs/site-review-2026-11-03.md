# Meals site review: work list

Full read-only review of `main` at `86004ad` (Meals 1.9) on 2026-11-03. Each item was found by one reviewer and confirmed by a second that tried to disprove it. It is a snapshot: line numbers drift as the code changes, so check the code before acting on an item.

162 items have become "Review:" tickets in Jira (MEA-64 to MEA-223, in Meals 1.12 or the backlog), 1 was already a ticket (MEA-54) and 1 was dropped, so they're no longer listed here. The 10 items below keep their original numbers; all of them were looked at in triage on 2026-11-04 and kept for later, marked "Skipped in triage".

## How to use this list

- Item numbers are fixed. Refer to items by number (for example #77) when we discuss them.
- Tick an item (`- [x]`) when its fix is merged, or when we decide not to do it; then add "Won't do:" and the reason under it.
- **High**: wrong results, a broken flow or an outage people can hit. **Medium**: an edge-case bug, notable debt or real friction. **Low**: minor.
- **Reopens design** means doing it changes a decision in docs/design.md, so the design is updated in the same change (AGENTS.md).
- **MEA-n** means a Jira ticket already covers it or is related.
- **Likely, not fully proven** marks the few items the second reviewer couldn't fully reproduce.

## 1. Backend issues and tech debt

### Security and abuse

- [ ] **#5 Low** Feedback's page field accepts line breaks, so a sender can add a fake From line to the Jira ticket
  - **Where:** `src/routes/(app)/feedback/+page.server.ts:23`, `src/lib/server/jira.ts:36`, `src/lib/server/jira.ts:50`
  - **Problem:** A member hand-crafts the feedback post. Every ticket's Jira reporter is the token's account (design 7), so the description is the only record of who sent it, and the first From and Household lines in it are the forged ones, against 'The sender and household come from the session.'
  - **Fix:** Refuse whitespace and control characters in page (a path and query from the browser has none), for example with .regex(/^\/\S*$/), and put the session's From and Household lines before anything the form sent.
  - **Notes:** Skipped in triage

### Data integrity and races

- [ ] **#13 Medium** Didn't come, Got fewer and Undo can leave two To Order lines for one item, and the duplicate prompt updates only one
  - **Where:** `src/lib/server/data/needs.ts:154`, `src/lib/server/data/needs.ts:349`, `src/lib/server/data/needs.ts:390`, `src/lib/server/data/needs.ts:407`
  - **Problem:** In the store, Yogurt 3 cups is on the list. Someone taps Got fewer 2, realizes they got none, and taps the Received today line to undo it. The Walmart group now has two Yogurt rows (1 and 2 cups) instead of the original line of 3. Later someone adds Yogurt, sees 'Already on the list: 1 cups' and updates it to 5, meaning 5 in total, and the list now asks for 7.
  - **Fix:** When a line goes back to To Order (undoReceived, markDidntCome, or the Got fewer remainder) and the item already has a To Order line in the same unit, add its quantity to that line and delete it in the same transaction. Undoing a Got fewer split should merge it back into its remainder. At a minimum, addNeed's duplicate prompt and Update should cover every open To Order line for the item.
  - **Verifier's correction:** Correction: the Didn't come case is a fair two-line state, since 3 gal really are needed. The defects are that addNeed's prompt and Update cover only one To Order line, and that undoing a Got fewer doesn't restore the original line. Totals stay right unless someone edits one line thinking it's the only one.
  - **Notes:** Skipped in triage
- [ ] **#16 Low** A double-tapped Create household on a slow connection shows the error page 'You already belong to a household'
  - **Where:** `src/routes/setup/+page.server.ts:13`, `src/lib/server/data/households.ts:17`, `src/routes/setup/+page.svelte:35`
  - **Problem:** On a weak phone connection someone taps Create household twice, since enhance doesn't block a second submit and the button stays enabled. Both requests pass the hook before either body arrives. The data stays correct (one household), but the second result is an error that enhance renders as 'Something went wrong / You already belong to a household'. The same happens if a member's invite joins this account while the person is submitting setup.
  - **Fix:** In the setup action, catch createHousehold's 400 (the person already has a household) and redirect(303, '/') instead of letting it become an error page. Optionally disable Create household while the request is in flight.
  - **Verifier's correction:** Correction: production nginx buffers each request body before forwarding it, so 'both requests pass the hook before either body arrives' doesn't happen there. The second tap has to reach Node within the few milliseconds the first takes, which only happens if the network delivers both at once. What the person sees depends on order. SvelteKit 3 applies the error in place only while the page is still on /setup (is_current_location, client.js:3015). If the redirect has already navigated away, it navigates back to /setup with the error result. I didn't watch this in a browser, so the visible effect is unverified. The data stays correct.
  - **Notes:** Likely, not fully proven. Skipped in triage

### Database, migrations, deploy and operations

- [ ] **#41 Medium** Running the Deploy workflow by hand on any branch deploys that branch to production
  - **Where:** `.github/workflows/deploy.yml:13`, `.github/workflows/deploy.yml:49`, `.github/workflows/deploy.yml:56`
  - **Problem:** Someone, or an agent with the GitHub Actions tool, clicks Run workflow on claude/mea-63 to re-run the checks. When the checks pass, that unmerged branch is built, tagged latest and deployed, and its migrations run on the production database. The branch stays live until the next push to main. Its migration is already recorded, so if review later changes that migration, the merged version never applies (see the reported 'migrate() skips a migration whose timestamp is older... and never notices an edited migration').
  - **Fix:** Add "&& github.ref == 'refs/heads/main'" to the deploy job's if, or put the job in a 'production' environment whose deployment rule only allows main.
  - **Notes:** Skipped in triage
- [ ] **#43 Low** migrate() skips a migration whose timestamp is older than the newest applied one, and never notices an edited migration
  - **Where:** `src/lib/server/db/index.ts:55`, `src/lib/server/db/index.ts:59`, `src/lib/server/db/index.ts:69`, `src/lib/server/db/migrate.spec.ts:41`
  - **Problem:** Two sprint tickets are built in parallel sessions, and both run db:generate. B merges and deploys first. A then merges main, settles the drizzle/meta conflict by renumbering its entry after B's, and keeps the when value it was generated with. Every test passes because freshDb applies the whole journal, and /healthz only runs select 1, so the deploy goes green. Production never gets A's column or table, and the pages that use it fail with 'no such column'. In the same way, a fix to a hand-written custom migration (like 0009 or 0014) after it deployed changes fresh databases but never production.
  - **Fix:** Decide what is pending from what is recorded: apply, in journal order, every journal entry whose created_at or hash is missing from __drizzle_migrations. Refuse to start, or at least log, when a recorded migration's hash differs from its file. Add a migrate.spec case for an entry that is out of timestamp order.
  - **Notes:** Skipped in triage
- [ ] **#44 Low** Two app processes starting at once both run the same pending migrations, and one crashes with 'table already exists'
  - **Where:** `src/lib/server/db/index.ts:55`, `src/lib/server/db/index.ts:66`, `src/lib/server/db/index.ts:78`
  - **Problem:** Two app processes can start together on a database with pending migrations: dokku ps:scale web=2, a restart that overlaps a deploy, or a one-off dokku run of the app. Both compute the same pending list, one waits for the lock, then it re-runs the first migration and dies at startup. A data-only custom migration such as 0009 or 0014 could instead be applied twice. AGENTS.md says the immediate lock handles overlapping deploys, but that applies to transaction(), not to migrate().
  - **Fix:** Read the bookkeeping table and compute pending inside the migration transaction, and run it with .immediate(), so a second process waits and then finds nothing to do. Also restore foreign_keys = ON in a finally block.
  - **Verifier's correction:** Correction: with only the data migration 0014 pending (stage-0014.mjs), the second process does not apply it twice. 0014's own guard trigger aborts it ('whats_new_seen has a date that no release has') and the value stays '1.5'. Severity stays low. Only hooks.server.ts:18 migrates, scripts/backup.js opens its own connection without migrating, the app runs as a single web container, and a Dokku deploy starts one new container while the old, already migrated one serves. So the race needs ps:scale web=2 or a one-off run of the server, and the failed process's restart then finds nothing pending.
  - **Notes:** Skipped in triage

### Docs and code health

- [ ] **#65 Low** Design 4.6's code layout and AGENTS.md's signature exceptions leave out tour.ts and several server and lib modules
  - **Where:** `docs/design.md:296`, `docs/design.md:280`, `AGENTS.md:44`, `src/lib/server/data/tour.ts:10`
  - **Problem:** An agent following 4.6 or AGENTS.md to add a per-person setting can't tell where it belongs, or 'fixes' tour.ts to take householdId first. Someone looking for the form helpers or fold() won't find them in the layout.
  - **Fix:** Update 4.6's tree and its exceptions sentence. Add the tour to AGENTS.md's list, for example: 'a person's tour and What's new state take the person's id'.
  - **Also covers:** design.md 4.6 says data functions take householdId first except What's new, but tour.ts also takes the person's id
  - **Notes:** Skipped in triage

## 2. Frontend issues

### Network failures and lost typing

- [ ] **#71 Medium** A recipe filled in by Import from a link is dropped without asking if the person leaves before saving
  - **Where:** `src/routes/(app)/recipes/new/+page.svelte:70`, `src/lib/components/RecipeForm.svelte:67`, `src/lib/components/RecipeForm.svelte:85`
  - **Problem:** On a phone, someone imports a recipe from a link, then switches to Groceries to check an item before tapping Save. The filled-in recipe and the link are gone, with no warning.
  - **Fix:** Compare against a new recipe's starting values rather than the imported ones (pass the page's own data.values as the baseline), or mark the editor changed after a successful import.
  - **Notes:** Skipped in triage

### Accessibility

- [ ] **#116 Low** In Windows high contrast mode, the chosen type, current tab, selected tag and active suggestion look unselected
  - **Where:** `src/lib/components/DinnerEditor.svelte:302`, `src/routes/(app)/+layout.svelte:226`, `src/app.css:281`, `src/lib/components/ItemInput.svelte:213`
  - **Problem:** With a Windows contrast theme, someone opens a dinner. Cooking at home, Eating out, Bringing a dish and Leftovers look the same, so they can't see which type is set. On Recipes they can't see which tags filter the list, the tab bar doesn't show which tab they're on, and arrowing through suggestions shows no highlight.
  - **Fix:** Add `@media (forced-colors: active)` rules that mark these states with system colors, for example `button[aria-pressed='true'], .chip[aria-current='true'], li[aria-selected='true'] { forced-color-adjust: none; background: SelectedItem; color: SelectedItemText; }`. Draw the current tab's bar with `border-top` instead of box-shadow.
  - **Notes:** Skipped in triage

### Frontend code health

- [ ] **#133 Low** The 730-line week page repeats near-identical request handlers that already diverged, and copies DayRequests' list
  - **Where:** `src/routes/(app)/menu/+page.svelte:65`, `src/routes/(app)/menu/+page.svelte:107`, `src/routes/(app)/menu/+page.svelte:141`, `src/routes/(app)/menu/+page.svelte:278`
  - **Problem:** The next change to requests (MEA-44 screenshots, a new field) has to be made in three handlers and two lists, and one copy gets missed, as navigate: false already was.
  - **Fix:** Extract a RequestSheet component or one submit helper that always applies results in place, a shared RequestSummary for the week and DayRequests, a shared failureMessage in #lib, and move swipe and drag into Svelte actions.
  - **Verifier's correction:** Corrections: (1) groceries/+page.svelte:23 and DinnerDishes.svelte:49 have their own failure helpers, so 'failureMessage exists only on this page' is true of the name only. (2) MEA-44 ('Feedback: Add screenshot to request') is about feedback, not menu requests. (3) About 215 of the 730 lines are CSS. The user-facing bug is already MEA-43; this finding's value is fixing it in one shared place. Lowered to low because the duplication stays within two components.
  - **Notes:** Skipped in triage

## Dropped during verification

Not worth raising again unless something changes:

- Typing an archived item's name offers to add it as new, then asks to restore it. By design (6.4, 6.10): suggestions leave archived items out, and adding the name offers to restore it.
- Grocery quantities can't be typed as fractions like 1/2. Not worth it: a grocery quantity is a number (Q16), and the phone's decimal keypad has no "/" or space.
- Remove deletes a request at once with no undo. Not worth it: 6.12 removes without asking, a request takes seconds to add again, and there is no undo pattern to reuse.
- Adding a dish or grocery item briefly moves focus to the page, closing the phone keyboard. The focus bounce is real, but the blur and refocus happen in the same task, so the keyboard isn't expected to close.
- The four type buttons are announced as toggle buttons. Not a defect: pressed buttons say which type is current, and a radio group's arrow keys would save a type on every press.
- A date with several dinners is one long page. By design (7, Dinner).
- A dish link opens the recipe at unsaved servings, then asks to discard them. By design (7, Dinner), and covered by a browser test.
- Adding an archived dish's request asks for labels, then refuses. By design (6.12: restore it first).
- Ratings and Request push servings and Cook below the first screen. Not worth reopening: MEA-32 just put the ratings list there, and moving it gains about 120 px.

## Assumptions and limits

- The review covered the repo (code, tests, CI, deploy and docs), not the production server's Dokku and nginx settings, logs or data. Where a finding depends on those, Dokku defaults were assumed.
- docs/design.md is treated as intended behavior. Ideas that would change it are under UI/UX and marked "Reopens design".
- Accessibility problems are under Frontend, because they are defects in the pages.
- Browser checks used Chromium emulating phones, not real iPhones, Android phones or screen readers. There was no real Google sign-in, and feedback went to a local stand-in for Jira.
- "Where" lists up to four locations. Paths to review scripts were left out because those scripts lived in a temporary folder.
