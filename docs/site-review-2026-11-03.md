# Meals site review: work list

Full read-only review of `main` at `86004ad` (Meals 1.9) on 2026-11-03. Each item was found by one reviewer and confirmed by a second that tried to disprove it. It is a snapshot: line numbers drift as the code changes, so check the code before acting on an item.

On 2026-11-03, 48 items became "Review:" tickets in Jira (MEA-64 to MEA-80 in Meals 1.12, MEA-81 to MEA-111 in the backlog) and #4 was dropped, so they're no longer listed here. The 125 items below keep their original numbers.

## How to use this list

- Item numbers are fixed. Refer to items by number (for example #77) when we discuss them.
- Tick an item (`- [x]`) when its fix is merged, or when we decide not to do it; then add "Won't do:" and the reason under it.
- **High**: wrong results, a broken flow or an outage people can hit. **Medium**: an edge-case bug, notable debt or real friction. **Low**: minor.
- **Reopens design** means doing it changes a decision in docs/design.md, so the design is updated in the same change (AGENTS.md).
- **MEA-n** means a Jira ticket already covers it or is related.
- **Likely, not fully proven** marks the few items the second reviewer couldn't fully reproduce.

## Where to start

1. **Deploy only from main: #41.** One condition in deploy.yml stops a hand-run workflow from deploying any branch to production.
2. **Pass `navigate: false` in the enhance updates: #77, #87 (MEA-43).** The same SvelteKit 3 behavior causes both.
3. **Stop losing typed text: #71, #72, #73, #74.** Same theme as MEA-80 and MEA-111.
4. **Smooth the grocery list in the store: #13, #78, #79, #80, #81.**
5. **Finish the CSV import fixes: #75, #100.** The other import fixes are MEA-71 to MEA-74 in Meals 1.12 and MEA-89 in the backlog.

Items that share a cause or a fix:

- Stale pages: #82, #92, #93 (MEA-67 and MEA-69 handle the server side)
- No pending state on taps: #79, #91, #150
- Focus after a save: #102, #114, #117
- 320 px phones: #84, #99, #106
- Copy a dinner cost: #90 (with MEA-101 and MEA-102)
- Error pages: #108, #169 (with MEA-94)
- Outdated help: #113, #154

## 1. Backend issues and tech debt

### Security and abuse

- [ ] **#5 Low** Feedback's page field accepts line breaks, so a sender can add a fake From line to the Jira ticket
  - **Where:** `src/routes/(app)/feedback/+page.server.ts:23`, `src/lib/server/jira.ts:36`, `src/lib/server/jira.ts:50`
  - **Problem:** A member hand-crafts the feedback post. Every ticket's Jira reporter is the token's account (design 7), so the description is the only record of who sent it, and the first From and Household lines in it are the forged ones, against 'The sender and household come from the session.'
  - **Fix:** Refuse whitespace and control characters in page (a path and query from the browser has none), for example with .regex(/^\/\S*$/), and put the session's From and Household lines before anything the form sent.
- [ ] **#6 Low** One household can claim any email with an invite, blocking other households and pulling the person in on sign-in
  - **Where:** `src/lib/server/data/households.ts:81`, `src/lib/server/data/households.ts:93`, `src/lib/server/auth/sign-in.ts:28`, `src/routes/(app)/household/+page.server.ts:52`
  - **Problem:** A member of one household invites people another household means to invite, or a long list of addresses. The other household is told 'already has an invite' but can't see or cancel it, and neither can the admin. When the person signs in they land in the wrong household, whose members see their name and email, and only that household can remove them. Once MEA-26 sends invite emails, the missing cap also lets a member mail any number of addresses.
  - **Fix:** Keep invites per household and email so each household's invite stands on its own; when a person signing in has several, ask which household to join (or take the oldest and say so). Cap pending invites per household (for example 20) and list every pending invite on Admin.
  - **Notes:** Reopens design: 6.1 item 4 (inviting fails if the email already has an invite from any household)
- [ ] **#10 Low** Import from a link's address check lets through NAT64, 6to4 and other non-public ranges
  - **Where:** `src/lib/server/recipe-page.ts:16`, `src/lib/server/recipe-page.ts:32`, `src/lib/server/recipe-page.spec.ts:15`
  - **Problem:** On a host that reaches IPv4 through NAT64 (IPv6-only servers or subnets), a member imports http://[64:ff9b::a00:5]/ and the gateway carries the request to 10.0.0.5 on the private network, which design 4.5 says is never fetched. Where a machine's own or neighboring addresses sit in an unlisted range, as this review container's 192.0.2.2 does, its services are reachable the same way. Docker's default 172.17.0.0/16 is blocked, so today's Dokku host is likely unaffected.
  - **Fix:** Refuse every IANA special-purpose block that isn't globally reachable (for example 192.0.0.0/24, 198.18.0.0/15, 240.0.0.0/4, the TEST-NETs, multicast, ::/96, 64:ff9b::/96, 64:ff9b:1::/48, 2002::/16, 2001::/32), or check the IPv4 address embedded in NAT64 and 6to4 addresses against the IPv4 list. Add them to PRIVATE_LINKS in the spec and mention NAT64 in design 4.5.

### Data integrity and races

- [ ] **#13 Medium** Didn't come, Got fewer and Undo can leave two To Order lines for one item, and the duplicate prompt updates only one
  - **Where:** `src/lib/server/data/needs.ts:154`, `src/lib/server/data/needs.ts:349`, `src/lib/server/data/needs.ts:390`, `src/lib/server/data/needs.ts:407`
  - **Problem:** In the store, Yogurt 3 cups is on the list. Someone taps Got fewer 2, realizes they got none, and taps the Received today line to undo it. The Walmart group now has two Yogurt rows (1 and 2 cups) instead of the original line of 3. Later someone adds Yogurt, sees 'Already on the list: 1 cups' and updates it to 5, meaning 5 in total, and the list now asks for 7.
  - **Fix:** When a line goes back to To Order (undoReceived, markDidntCome, or the Got fewer remainder) and the item already has a To Order line in the same unit, add its quantity to that line and delete it in the same transaction. Undoing a Got fewer split should merge it back into its remainder. At a minimum, addNeed's duplicate prompt and Update should cover every open To Order line for the item.
  - **Verifier's correction:** Correction: the Didn't come case is a fair two-line state, since 3 gal really are needed. The defects are that addNeed's prompt and Update cover only one To Order line, and that undoing a Got fewer doesn't restore the original line. Totals stay right unless someone edits one line thinking it's the only one.
- [ ] **#15 Low** Two members removing each other at the same moment leaves a household with no members
  - **Where:** `src/lib/server/data/households.ts:48`, `src/hooks.server.ts:25`, `src/routes/(app)/household/+page.server.ts:80`
  - **Problem:** Members A and B both tap Remove on each other at nearly the same time, for example on a slow phone connection. The hook checks B's session when the headers arrive, A's removal deletes B, then B's action still runs and deletes A. The household is left with no members. Nobody can open it or invite into it again, and households can't be deleted (section 12), so its data is orphaned.
  - **Fix:** Wrap removeMember in transaction() and first check that actingUserId still belongs to householdId (error 404 if not). The immediate lock serializes the two removals, so the second one finds its own account gone and stops.
  - **Verifier's correction:** Correction: production runs behind Dokku's nginx, which buffers request bodies by default (proxy_request_buffering on), so a slow phone upload doesn't widen the window. The two removals would have to reach Node within a few milliseconds of each other. If that happens the result is as described: Admin shows 'No members', the data can't be reached, and the UI offers no way to recover. It is very unlikely, so low rather than medium. The proposed fix (do it in transaction() and check the acting user's membership) is right.
- [ ] **#16 Low** A double-tapped Create household on a slow connection shows the error page 'You already belong to a household'
  - **Where:** `src/routes/setup/+page.server.ts:13`, `src/lib/server/data/households.ts:17`, `src/routes/setup/+page.svelte:35`
  - **Problem:** On a weak phone connection someone taps Create household twice, since enhance doesn't block a second submit and the button stays enabled. Both requests pass the hook before either body arrives. The data stays correct (one household), but the second result is an error that enhance renders as 'Something went wrong / You already belong to a household'. The same happens if a member's invite joins this account while the person is submitting setup.
  - **Fix:** In the setup action, catch createHousehold's 400 (the person already has a household) and redirect(303, '/') instead of letting it become an error page. Optionally disable Create household while the request is in flight.
  - **Verifier's correction:** Correction: production nginx buffers each request body before forwarding it, so 'both requests pass the hook before either body arrives' doesn't happen there. The second tap has to reach Node within the few milliseconds the first takes, which only happens if the network delivers both at once. What the person sees depends on order. SvelteKit 3 applies the error in place only while the page is still on /setup (is_current_location, client.js:3015). If the redirect has already navigated away, it navigates back to /setup with the error result. I didn't watch this in a browser, so the visible effect is unverified. The data stays correct.
  - **Notes:** Likely, not fully proven
- [ ] **#22 Low** Undoing a check-off made through Where did you get it? keeps the picked store on the line and as the default
  - **Where:** `src/lib/server/data/needs.ts:407`, `src/lib/server/data/needs.ts:303`
  - **Problem:** In the store, someone taps the wrong store under 'Where did you get it?', sees the line under Received today and taps it again, as section 11 suggests for mis-taps. The line moves from No store to Aldi, and the next time Paper towels is added, Aldi is filled in instead of Walmart.
  - **Fix:** Keep what the check-off replaced (the line's store and the item's previous default store) so undoReceived can restore both. At a minimum, put the line back under No store when its store was picked during the check-off.
  - **Verifier's correction:** Correction: the default goes back to Walmart once the line is checked off at Walmart. The lasting effect is that the line now sits in the Aldi group, so its circle no longer asks for a store, and a second tap records Aldi in history unless someone edits the store first. Putting the line back under No store needs its earlier store saved, and the schema has no column for that.

### CSV import and Import from a link

- [ ] **#31 Low** Imported text keeps references like &eacute; and &reg;, and &#146; becomes an invisible control character
  - **Where:** `src/lib/recipe-schema.ts:35`, `src/lib/recipe-schema.ts:62`
  - **Problem:** Someone imports a recipe whose JSON-LD escapes accented letters or symbols. The editor shows 'jalape&ntilde;o', and saved without noticing it becomes a catalog item and grocery suggestion that can only be archived. Design 7 says character references are taken out of the text.
  - **Fix:** Decode every HTML5 named reference (a complete table, or the entities package's decodeHTML) and map &#128; to &#159; to their windows-1252 characters, as the HTML spec does.

### Database, migrations, deploy and operations

- [ ] **#41 Medium** Running the Deploy workflow by hand on any branch deploys that branch to production
  - **Where:** `.github/workflows/deploy.yml:13`, `.github/workflows/deploy.yml:49`, `.github/workflows/deploy.yml:56`
  - **Problem:** Someone, or an agent with the GitHub Actions tool, clicks Run workflow on claude/mea-63 to re-run the checks. When the checks pass, that unmerged branch is built, tagged latest and deployed, and its migrations run on the production database. The branch stays live until the next push to main. Its migration is already recorded, so if review later changes that migration, the merged version never applies (see the reported 'migrate() skips a migration whose timestamp is older... and never notices an edited migration').
  - **Fix:** Add "&& github.ref == 'refs/heads/main'" to the deploy job's if, or put the job in a 'production' environment whose deployment rule only allows main.
- [ ] **#43 Low** migrate() skips a migration whose timestamp is older than the newest applied one, and never notices an edited migration
  - **Where:** `src/lib/server/db/index.ts:55`, `src/lib/server/db/index.ts:59`, `src/lib/server/db/index.ts:69`, `src/lib/server/db/migrate.spec.ts:41`
  - **Problem:** Two sprint tickets are built in parallel sessions, and both run db:generate. B merges and deploys first. A then merges main, settles the drizzle/meta conflict by renumbering its entry after B's, and keeps the when value it was generated with. Every test passes because freshDb applies the whole journal, and /healthz only runs select 1, so the deploy goes green. Production never gets A's column or table, and the pages that use it fail with 'no such column'. In the same way, a fix to a hand-written custom migration (like 0009 or 0014) after it deployed changes fresh databases but never production.
  - **Fix:** Decide what is pending from what is recorded: apply, in journal order, every journal entry whose created_at or hash is missing from __drizzle_migrations. Refuse to start, or at least log, when a recorded migration's hash differs from its file. Add a migrate.spec case for an entry that is out of timestamp order.
- [ ] **#44 Low** Two app processes starting at once both run the same pending migrations, and one crashes with 'table already exists'
  - **Where:** `src/lib/server/db/index.ts:55`, `src/lib/server/db/index.ts:66`, `src/lib/server/db/index.ts:78`
  - **Problem:** Two app processes can start together on a database with pending migrations: dokku ps:scale web=2, a restart that overlaps a deploy, or a one-off dokku run of the app. Both compute the same pending list, one waits for the lock, then it re-runs the first migration and dies at startup. A data-only custom migration such as 0009 or 0014 could instead be applied twice. AGENTS.md says the immediate lock handles overlapping deploys, but that applies to transaction(), not to migrate().
  - **Fix:** Read the bookkeeping table and compute pending inside the migration transaction, and run it with .immediate(), so a second process waits and then finds nothing to do. Also restore foreign_keys = ON in a finally block.
  - **Verifier's correction:** Correction: with only the data migration 0014 pending (stage-0014.mjs), the second process does not apply it twice. 0014's own guard trigger aborts it ('whats_new_seen has a date that no release has') and the value stays '1.5'. Severity stays low. Only hooks.server.ts:18 migrates, scripts/backup.js opens its own connection without migrating, the app runs as a single web container, and a Dokku deploy starts one new container while the old, already migrated one serves. So the race needs ps:scale web=2 or a one-off run of the server, and the failed process's restart then finds nothing pending.
- [ ] **#45 Low** Migrations aren't required to keep the previous release working, though both releases use the database during a deploy
  - **Where:** `drizzle/0014_whats-new-seen-version.sql:13`, `src/lib/server/data/whats-new.ts:12`, `src/routes/(app)/+layout.server.ts:14`, `AGENTS.md:59`
  - **Problem:** During the deploy that added 0014, someone opens What's new on the old container after the new one has already changed dates to versions. Their row gets '2026-11-02' again. From then on, the (app) layout load throws on every page they open, including What's new itself, so it can't fix itself without a database edit. Rolling back to an older image is the same kind of problem: the old image's migrate() applies nothing, so the old code runs against the newer schema.
  - **Fix:** Add a rule to the Database section of AGENTS.md: a migration must leave the previous release working (add things first, and convert or drop them in a later release), and a data conversion ships with code that still reads the old form. Note rollback limits in README. MEA-63 covers making the What's new check accept unknown values.
  - **Verifier's correction:** Corrections: the exposure is only the seconds between the new container's startup migration and Dokku's traffic switch, and the 0014 deploy is already past. 'Can't fix itself without a database edit' is overstated. SvelteKit 3.0.0 starts every server load before awaiting any (node_modules/@sveltejs/kit/src/runtime/server/page/index.js:168), so a visit to /whats-new runs that page's load (whats-new/+page.server.ts:9), which records '1.9', and the next page works. A member wouldn't know to type that URL, though, because the root +error.svelte only links to /. MEA-63 (open) covers tolerating an unknown version.
- [ ] **#47 Low** Server errors are logged as bare stack traces with no page or person, and nothing tells anyone they happened
  - **Where:** `src/hooks.server.ts:13`, `src/routes/+error.svelte:7`, `src/routes/(app)/+layout.svelte:59`
  - **Problem:** A member hits a 500, for example the What's new crash in the rollback finding. dokku logs shows a stack trace with no path, method, person or household, and nobody is told. The member has no reference to quote and no Feedback button on that page, so the error is likely never reported.
  - **Fix:** Add handleError to hooks.server.ts. It should log one line with an error id, the method, route id, status, user id and household id (no email), return { message, id }, and show the id on +error.svelte. To get errors noticed, optionally open one Jira ticket per new error signature through the existing jira.ts, rate-limited.
  - **Verifier's correction:** Correction: Dokku's nginx access log records each request's method, path, status and time, so a 500 can be matched to its stack trace by time. What is really missing is the person, the household and any alert. Design 7 puts Feedback on the screens from Grocery list to Admin and says nothing about error pages. With a few invited households, this is a useful improvement but low, not medium.
- [ ] **#48 Low** The deploy job runs actions by movable tags, and their post steps run after the deploy key is written to disk
  - **Where:** `.github/workflows/deploy.yml:56`, `.github/workflows/deploy.yml:58`, `.github/workflows/deploy.yml:60`, `.github/workflows/deploy.yml:67`
  - **Problem:** Suppose one of those tags is repointed to a malicious commit, as happened to tj-actions/changed-files in March 2025. Its post step can read the deploy key. That key can run dokku git:from-image, so it can deploy any image to meals.dev.boyersoftware.com, with every household's data and the Google and Jira secrets inside.
  - **Fix:** Pin each action to a full commit SHA, with the version in a comment, and let Dependabot's github-actions updates bump them. Remove the key when the step ends (trap 'rm -f ~/.ssh/id_ed25519' EXIT), or load it into ssh-agent instead of writing a file.
  - **Verifier's correction:** Correction: the repo has no .github/dependabot.yml (.github holds only workflows/), so 'let Dependabot bump them' means adding one. This part of the workflow is unchanged from the shared placeholder pipeline (01bb5f7), so the sibling dev.boyersoftware.com projects have it too.
- [ ] **#50 Low** Routine updates are pending, including vite's dev-server advisories, and nothing like Dependabot surfaces them
  - **Where:** `package.json:27`, `package.json:40`, `package.json:22`
  - **Problem:** Advisories such as zod's and vite's stay in the lockfile until someone runs npm audit by hand. Today nothing in CI or the repo would raise them.
  - **Fix:** Run npm update (only package-lock.json changes), run the three checks, and commit. Playwright 1.64 brings a new Chromium, so watch the touch tests. Hold TypeScript at 6.x until svelte-check supports 7, and keep @types/node on 24 to match the Node 24 runtime. Add .github/dependabot.yml for npm, github-actions and docker.
  - **Verifier's correction:** corrections. npm outdated (read-only) matches the list. It also shows zod 4.6.5 to 4.6.7 and @types/node 24.19.2, all within the existing ranges. npm audit without fix (saved to (review script)) reports vite 8.3.0-8.3.2 with one high advisory, GHSA-587h-7wmj-h5pm (launch-editor, Windows only), plus moderate and low ones, all fixed in 8.3.5. These live in the dev server. /__open-in-editor is mounted in createServer (node_modules/vite/dist/node/chunks/node.js:24891) but not in preview() (:35414 on, static serving only), so the `vite preview` the browser tests use is mostly not exposed.

### Tests and tooling

- [ ] **#57 Low** Nothing in CI checks that the migrations in drizzle/ still match schema.ts
  - **Where:** `.github/workflows/deploy.yml:41`, `src/lib/server/db/schema.ts:1`, `drizzle.config.ts:4`
  - **Problem:** Someone adds an index or a CHECK to schema.ts and forgets npm run db:generate. The code type-checks and every test passes, because tests build their database from drizzle/. Production never gets the change, and the next unrelated db:generate pulls it into someone else's migration.
  - **Fix:** Add a Vitest spec that builds the schema from schema.ts with drizzle-kit's API (or generates it into a temporary folder) and compares it with freshDb()'s tables, indexes and constraints, the same way compare-schema.mjs does.
- [ ] **#60 Low** CI throws away the traces of failed browser tests and the visual-review screenshots it spends time making
  - **Where:** `.github/workflows/deploy.yml:45`, `playwright.config.ts:19`, `tests/e2e/screens.e2e.ts:14`
  - **Problem:** A browser test fails only on CI, like the touch test that fails only on full Chrome. The only record is a one-line annotation, so nobody can open the trace. The screens test runs in every pipeline and produces nothing anyone can see.
  - **Fix:** After the e2e step, add actions/upload-artifact (pinned by SHA) with if: ${{ !cancelled() }}, path test-results/ and a short retention. Either skip screens.e2e.ts on CI or keep its screenshots in that artifact.
  - **Verifier's correction:** correction: the 'github' reporter (playwright/lib/runner/index.js:3295-3376) emits each failure's header, error message and stack as an error annotation, so it is more than one line. What is lost is the trace (DOM snapshots, network, console) and the screenshots. Low.
- [ ] **#62 Low** About 120 page.goto calls in browser tests still tap or type before the page's script has started
  - **Where:** `tests/e2e/groceries.e2e.ts:89`, `tests/e2e/recipes.e2e.ts:948`, `tests/e2e/items.e2e.ts:3`
  - **Problem:** On a slow runner, the first fill happens before the script starts. The add form then posts without JavaScript, and the test fails although the app works.
  - **Fix:** Switch the remaining gotos that are followed by a tap or typing to open(page, path).
  - **Notes:** MEA-22

### Docs and code health

- [ ] **#64 Low** design.md 6.1 doesn't describe how an invite treats an account that signed in but has no household
  - **Where:** `src/lib/server/data/households.ts:63`, `src/lib/server/data/households.ts:77`, `docs/design.md:410`
  - **Problem:** Someone changing invites or setup reads 6.1, the source of truth, and doesn't learn that a household invite instantly moves a no-household account in, or that the admin can't re-invite one. They may 'fix' the code back to the documented rule or miss the case in tests.
  - **Fix:** Add to 6.1 (3) and (4): an account that signed in but has no household joins right away when a member invites it, and the admin's household invite to such an account is refused as an existing account.
- [ ] **#65 Low** Design 4.6's code layout and AGENTS.md's signature exceptions leave out tour.ts and several server and lib modules
  - **Where:** `docs/design.md:296`, `docs/design.md:280`, `AGENTS.md:44`, `src/lib/server/data/tour.ts:10`
  - **Problem:** An agent following 4.6 or AGENTS.md to add a per-person setting can't tell where it belongs, or 'fixes' tour.ts to take householdId first. Someone looking for the form helpers or fold() won't find them in the layout.
  - **Fix:** Update 4.6's tree and its exceptions sentence. Add the tour to AGENTS.md's list, for example: 'a person's tour and What's new state take the person's id'.
  - **Also covers:** design.md 4.6 says data functions take householdId first except What's new, but tour.ts also takes the person's id
- [ ] **#68 Low** The hidden pantry check keeps about 1,750 lines and 61 tests that nothing reaches, and they've drifted
  - **Where:** `src/lib/server/data/pantry.ts:147`, `src/lib/checklist.ts:112`, `src/lib/server/data/needs.ts:211`, `src/lib/server/data/pantry.spec.ts:1`
  - **Problem:** Every change to dinners, dishes, items or grocery lines must keep this unused code compiling and its 61 tests passing, and it still falls behind: if the check returns, its lines can't tell a date's Kids and Adults dinners apart.
  - **Fix:** Either remove pantry.ts, checklist.ts, their specs and the two needs.ts helpers (git keeps them; leave the tables and always_have so stored checks survive) and say in 6.8 that the code will be rebuilt, or keep it and list in 6.8 what it doesn't yet cover, such as several labeled dinners on a date.
  - **Notes:** Reopens design: 6.8: 'It may come back, so its data and code stay'

## 2. Frontend issues

### Network failures and lost typing

- [ ] **#71 Medium** A recipe filled in by Import from a link is dropped without asking if the person leaves before saving
  - **Where:** `src/routes/(app)/recipes/new/+page.svelte:70`, `src/lib/components/RecipeForm.svelte:67`, `src/lib/components/RecipeForm.svelte:85`
  - **Problem:** On a phone, someone imports a recipe from a link, then switches to Groceries to check an item before tapping Save. The filled-in recipe and the link are gone, with no warning.
  - **Fix:** Compare against a new recipe's starting values rather than the imported ones (pass the page's own data.values as the baseline), or mark the editor changed after a successful import.
- [ ] **#72 Medium** With two dinners, Save on one asks an unnamed 'Leave without saving?' about the other, so that dinner's typing is easily lost
  - **Where:** `src/lib/components/DinnerDetails.svelte:103`, `src/lib/components/DinnerDetails.svelte:111`, `src/lib/components/DinnerDetails.svelte:173`, `src/lib/components/DinnerDetails.svelte:224`
  - **Problem:** On a Kids and Adults day, type a note in each and tap Save under Kids. The page goes to the week and asks 'Leave without saving?' right after Save, without saying it means Adults. OK seems like the obvious answer after a Save, and it drops the Adults note. Tapping '‹ Week of' asks the same question twice in a row.
  - **Fix:** Ask once, from the page, naming the dinners that have unsaved typing (for example 'Adults has a note you haven't saved. Leave anyway?'). Alternatively, on a date with several dinners, make Save keep the person on the page or save every dinner's details.
- [ ] **#73 Medium** A dish name typed but not added is dropped without asking when the person leaves or taps Save
  - **Where:** `src/lib/components/DinnerDetails.svelte:89`, `src/lib/components/DinnerDetails.svelte:173`, `src/lib/components/DinnerDishes.svelte:162`, `src/lib/components/ItemInput.svelte:77`
  - **Problem:** Someone types a new dish, taps the 'Add … as a new dish' suggestion (it only closes the list), then taps Save thinking that saves everything. The week opens and the dish was never added, with no question.
  - **Fix:** Count a non-empty dish field (normalizeName(name) !== '') as unsaved, so hasUnsaved and confirmLeave ask about it, or have Save add a typed dish before it saves the details.
- [ ] **#74 Medium** Two quick changes on an unplanned date: the second is refused as someone else's, and the typed note can be wiped
  - **Where:** `src/routes/(app)/menu/[date]/+page.svelte:89`, `src/routes/(app)/menu/[date]/+page.svelte:92`, `src/routes/(app)/menu/[date]/+page.svelte:135`, `src/lib/components/DinnerEditor.svelte:189`
  - **Problem:** On a slow phone connection, on a day not planned yet, the person types a note, taps Bringing a dish and quickly picks the dish to bring. The dish is refused because the form still has no dinnerId. The typed note is cleared from the form, and both messages blame someone else. Tapping a type and then Save quickly fails Save the same way.
  - **Fix:** Count the page's own changes in flight instead of using one flag (increment when a change is sent, decrement after its reload settles, and treat reloads as own while the count is above zero). Also queue or disable a dinner's other immediate controls while one change is in flight, so nothing is sent from the stale unplanned form.
- [ ] **#75 Medium** Fixing the CSV and tapping Import again fails in Chrome and Edge, and the page blames the connection
  - **Where:** `src/routes/(app)/recipes/import/+page.svelte:66`, `src/routes/(app)/recipes/import/+page.svelte:79`, `src/routes/(app)/recipes/import/+page.svelte:39`
  - **Problem:** Someone imports a CSV that has a problem. They fix the row in Excel or Numbers, save over the same file and tap Import, as the page tells them to. The field still shows the file name, so they don't choose it again. Chromium won't upload a file that changed after it was chosen, so the page tells them to check their connection. Every retry fails the same way until they happen to choose the file again.
  - **Fix:** After a problems result, clear the file field and say "Fix these problems, then choose the file again." Keep the file only for the duplicate choices, as design 7 requires. Alternatively, catch the failed upload and say the file changed and needs choosing again. The wrong "Check your connection" text is the import-message finding that was already reported. This root cause is the old file being kept after problems.
  - **Verifier's correction:** Correction to the fix: the server also returns problems together with duplicates for rename problems (import/+page.server.ts:10-12). In that case the file is unchanged and must stay, so clear the field only for a problems result that has no duplicates. I verified Chromium only. Other engines may re-send a stale copy instead, which I didn't check.
  - **Also covers:** The import page says 'Nothing was imported... Check your connection' for errors where that's wrong
- [ ] **#76 Low** On a Household page opened directly, the first data reload resets typed name and servings to the saved values
  - **Where:** `src/routes/(app)/household/+page.svelte:43`, `src/routes/(app)/household/+page.svelte:55`, `src/lib/components/RecipeForm.svelte:10`
  - **Problem:** The phone reloads a discarded Household tab. Someone types a new household name and servings, switches to Messages to check a spelling, and comes back, or adds a store before tapping Save. The fields show the old values again, and the next Save keeps them.
  - **Fix:** Do what RecipeForm does: copy the settings into $state once, use bind:value, and reset them only after a successful Save. Add a browser test that types, returns to the tab and checks the fields.

### Grocery list, Items and History

- [ ] **#77 Medium** Saving, archiving or restoring an item on Items drops the search and the archived view
  - **Where:** `src/routes/(app)/groceries/items/+page.svelte:31`, `src/routes/(app)/groceries/items/+page.svelte:90`, `src/routes/(app)/groceries/items/+page.svelte:114`, `src/routes/(app)/groceries/items/+page.svelte:117`
  - **Problem:** Search Items for 'coff', tap Coffee, change its notes and tap Save: the search box still shows 'coff' but the list now shows every item from Apples down, and only Back brings the search back. Restoring several archived items means reopening Show archived items after each one, and archiving from a search loses the search too.
  - **Fix:** Pass navigate: false in the Items sheet's update call, as recipes/[id] and menu already do, so the result applies to the current address. MEA-43 is the same SvelteKit 3 enhance behavior on the Menu, so one shared fix could cover both; add a browser test that edits from a search and restores from the archived view.
- [ ] **#78 Medium** History shows last year's dates without the year, so they read as this year's
  - **Where:** `src/routes/(app)/groceries/history/+page.svelte:27`, `src/routes/(app)/groceries/history/+page.server.ts:25`
  - **Problem:** History's help says to search it to see when you last bought an item. Milk bought on 2025-10-19 shows as 'Sun, Oct 19', which reads as two weeks ago, and from every January 1 all of last year's history loses its year.
  - **Fix:** Return today (dateIn(Date.now(), timeZone)) from the History load and pass { today: data.today } to formatDateLabel, as the Items page does.
- [ ] **#79 Medium** Check-off and Add show nothing while pending, so a second tap errors, duplicates or hits the next row
  - **Where:** `src/routes/(app)/groceries/+page.svelte:136`, `src/routes/(app)/groceries/+page.svelte:346`, `src/routes/(app)/groceries/+page.svelte:90`
  - **Problem:** In a store with a weak signal, a parent taps Bread's circle, sees nothing change and taps again: either a red error appears, or Bread has already moved to Received today and the second tap checks off Milk instead. Tapping Add twice turns one new item into a duplicate question that doubles the quantity if they tap Update.
  - **Fix:** Track submissions in flight on the grocery page: fill the circle and disable that row's buttons as soon as it is tapped, ignore repeat submits of a form until its result arrives, and treat 'already received' after a repeat tap as success.
- [ ] **#80 Medium** Collapsed store groups load expanded and snap shut once the script runs, so the list jumps
  - **Where:** `src/routes/(app)/groceries/+page.svelte:181`, `src/routes/(app)/groceries/+page.svelte:271`
  - **Problem:** Someone who folds away the stores they aren't at opens the list on a slow connection: every group shows open, they start scrolling, and a moment later everything moves up by over 1,000 px under their finger. On a fast connection it is still a visible jump on every load.
  - **Fix:** Keep the collapsed keys in a cookie (still per device) and read it in the page load so the server renders those groups closed, or hide group contents until the stored state has been applied.
- [ ] **#81 Medium** When a slow Add finishes, the list jumps back to the top and the add bar takes focus, even after scrolling away
  - **Where:** `src/routes/(app)/groceries/+page.svelte:66`, `src/routes/(app)/groceries/+page.svelte:99`
  - **Problem:** On a slow connection, someone adds Basil, scrolls down to the Walmart group and reaches for Bread's circle. The Add lands, the page snaps to the top, and the tap hits the add bar instead (on Android the keyboard may also open). They have to scroll back down and find Bread again.
  - **Fix:** Refocus the item field only if it, or the add form, still had focus when the result arrived, and use focus({ preventScroll: true }). Otherwise leave focus and scroll position alone.
- [ ] **#82 Low** Tapping a line someone else deleted removes it silently; the 'no longer on the list' message never shows
  - **Where:** `src/routes/(app)/groceries/+page.svelte:136`, `src/routes/(app)/groceries/+page.svelte:358`
  - **Problem:** Two people shop from the list; one deletes Cheddar while the other taps its circle in the store. The line vanishes without explanation, so the second person can't tell whether it was bought, deleted or a glitch.
  - **Fix:** When the failed line is gone after the refresh, show the message at the top of the list, where group errors already go, instead of inside the missing row.
- [ ] **#83 Low** History's Show older jumps back to the top of the page
  - **Where:** `src/routes/(app)/groceries/history/+page.svelte:43`
  - **Problem:** Someone scrolls to the bottom of 100 lines looking for an older purchase, taps Show older and lands back at today; they must scroll past the same 100 lines again to reach the new ones.
  - **Fix:** Add data-sveltekit-noscroll to the Show older link (and data-sveltekit-replacestate if Back shouldn't step through each page), and leave q out of the address when it is empty.
- [ ] **#84 Low** On a 320 px phone the add bar's store field shrinks to about 54 px and shows one letter
  - **Where:** `src/routes/(app)/groceries/+page.svelte:233`, `src/routes/(app)/groceries/+page.svelte:573`, `src/routes/(app)/groceries/+page.svelte:578`
  - **Problem:** On a first-generation iPhone SE or a small Android phone, typing Milk fills in its usual store, but the field shows only 'W' or 'U', so the person can't see or check which store the new line goes to before tapping Add.
  - **Fix:** Let the second row wrap at narrow widths (flex-wrap: wrap with the store select on its own full-width row), or shrink the quantity and unit fields below about 360 px.
  - **Verifier's correction:** Correction: the one-letter case happens only at 320 px (first-generation iPhone SE, rare now). At 360 px, the most common Android width, about five characters show, which usually identifies the store. The person can tap the select to see the full name, and the new line then appears in a visible store group where it can be edited. I lowered severity to low.
- [ ] **#85 Low** Long item names in the add bar's suggestions run together with no space between options
  - **Where:** `src/lib/components/ItemInput.svelte:199`
  - **Problem:** Typing 'mi' with two long names in the catalog shows a block of text where it is unclear where one suggestion ends, so the person can tap the wrong item.
  - **Fix:** Give options vertical padding (about 0.5rem) and a divider or gap so wrapped names stay distinct.
- [ ] **#86 Low** Long email addresses on Household and Admin run under Remove and Cancel and widen small phones' pages
  - **Where:** `src/routes/(app)/household/+page.svelte:71`, `src/routes/(app)/household/+page.svelte:113`, `src/routes/(app)/admin/+page.svelte:48`, `src/routes/(app)/admin/+page.svelte:65`
  - **Problem:** A member with a 30+ character address shows only part of it beside Remove, so whoever removes members or cancels an invite can't read the full address; on a small phone the whole Household and Admin pages scroll sideways.
  - **Fix:** Add overflow-wrap: anywhere to the email text in members, invites and Admin's household list (or to .row > .grow), as the grocery rows and sheets already do.

### Menu and the dinner page

- [ ] **#87 Medium** Request a dish, Restore it and request, and Remove jump back to this week; Escape in the suggestions closes the sheet
  - **Where:** `src/routes/(app)/menu/+page.svelte:85`, `src/routes/(app)/menu/+page.svelte:117`, `src/routes/(app)/menu/+page.svelte:286`, `src/routes/(app)/menu/+page.svelte:152`
  - **Problem:** Planning ahead: tap Next, Request a dish, request Lasagna. The sheet closes and the page shows this week, not the week being planned. Remove and restoring an archived dish do the same. Pressing Escape to dismiss the suggestion list closes the whole sheet.
  - **Fix:** Pass navigate: false in submitRequest, submitRestore and submitRemove as submitRestaurant does, and have ItemInput preventDefault and stop propagation when Escape closes an open list. Add e2e checks on a non-current week for all three.
  - **Notes:** MEA-43
- [ ] **#88 Medium** On a date with several dinners, the gap and divider between dinners never show, so they run together
  - **Where:** `src/lib/components/DinnerEditor.svelte:282`, `src/lib/components/DinnerEditor.svelte:258`, `src/lib/components/DinnerEditor.svelte:314`
  - **Problem:** Open a day that has Kids and Adults dinners on a phone. The 'Adults' heading sits right under Kids' Clear button with no gap and no divider, so that Clear looks like it belongs to Adults. The Clear sheet doesn't name the dinner either, so it's easy to clear the wrong one.
  - **Fix:** Render the switch Sheet inside the dinner's section (or use `.dinner.labeled ~ .dinner.labeled`) so the separator applies, and have the two-dinner browser test check that the second dinner has its top border.
- [ ] **#89 Medium** On a date's page, open dish suggestions cover the header, tab bar and feedback button, so a tap there adds a dish
  - **Where:** `src/lib/components/ItemInput.svelte:173`, `src/lib/components/ItemInput.svelte:189`, `src/lib/components/ItemInput.svelte:193`, `src/lib/components/DinnerDishes.svelte:333`
  - **Problem:** On a dinner's page, someone types 'Cr' in Add a dish. They close the phone keyboard (Android's back gesture keeps the field focused) or type on a tablet keyboard, then tap Recipes in the tab bar. The suggestion under their finger is added to the dinner, and the page stays. With the list open, scrolling up covers Help and More in the same way.
  - **Fix:** Set `z-index: auto` in `.inline ul`, so the in-page list stays under the sticky header, tab bar and feedback button. Keep z-index 30 only for the overlay list.
- [ ] **#90 Medium** Each dinner editor renders the whole Copy a dinner list into its closed sheet, making a date's page slow to render
  - **Where:** `src/lib/components/CopyDinner.svelte:141`, `src/lib/components/CopyDinner.svelte:65`, `src/lib/components/Sheet.svelte:5`, `src/lib/components/DinnerEditor.svelte:240`
  - **Problem:** Opening a two-dinner date after three years of use: the server spends about 0.3 s rendering two lists nobody opened, the phone parses and hydrates about 1,400 buttons, and every reload after a change re-renders them, formatting every date again.
  - **Fix:** Render the group list only while the sheet is open (or share one picker for the date's dinners), and cache Intl.DateTimeFormat instances in dates.ts instead of building one per call.
  - **Verifier's correction:** Correction: the server render is about 0.15 s; the bigger cost is the client re-render after every tap. The seed's high share of unique groups (about 80%) is an upper estimate. Related to menu-data-2: both come from the same unbounded list.
- [ ] **#91 Low** A second type tap while the first is still saving is silently dropped, and the type buttons show no progress
  - **Where:** `src/lib/components/DinnerEditor.svelte:145`, `src/lib/components/DinnerEditor.svelte:210`
  - **Problem:** On a slow connection the person taps Eating out and sees nothing change, so they tap Leftovers. The dinner ends up Eating out, and nothing says the second tap was ignored.
  - **Fix:** Show the tapped type as pending right away (for example pressed with aria-busy and a spinner), and either send the latest tap after the first finishes or visibly disable the other types until it does.
- [ ] **#92 Low** The Add a dinner and request label sheets keep failing after someone else changes the day's dinners
  - **Where:** `src/lib/components/AddDinner.svelte:33`, `src/lib/components/AddDinner.svelte:46`, `src/lib/components/AddDinner.svelte:68`, `src/lib/components/DayRequests.svelte:89`
  - **Problem:** Two people add a second dinner to the same day at about the same time. The slower person's sheet refuses every try with a message about 'this dinner' and never updates its question. Only closing and reopening the sheet works.
  - **Fix:** After a failure, rebuild the sheet's question from the reloaded dinners (asked = count, and choices for DayRequests) and say that the day's dinners changed, so the next try can succeed.
- [ ] **#93 Low** After a 'someone changed' refusal, the label sheets keep resending the refused labels until closed and reopened
  - **Where:** `src/lib/components/AddDinner.svelte:30`, `src/lib/components/AddDinner.svelte:46`, `src/lib/components/DayRequests.svelte:79`, `src/lib/components/DayRequests.svelte:128`
  - **Problem:** A opens Add a dinner on a date with one dinner, so it asks for both labels. B adds a second dinner meanwhile. A taps Add dinner and is refused; the page now shows two dinners, but the sheet still asks for the first dinner's label, and every retry gets the same refusal. A request's Add sheet behaves the same.
  - **Fix:** After a refusal, ask again from the date as it is now (take the refreshed count into the sheet, or close it and say why), and give Add a dinner a message that fits ('This day's dinners changed. Check the labels and try again.').
- [ ] **#94 Low** The drag's 'nothing moved' error stays on screen on every week the person goes to afterwards
  - **Where:** `src/routes/(app)/menu/+page.svelte:213`, `src/routes/(app)/menu/+page.svelte:346`, `src/routes/(app)/menu/+page.svelte:232`, `src/routes/(app)/menu/+page.svelte:406`
  - **Problem:** A drag fails because someone else changed the day. The person taps Next: the red alert still says that day's dinners were moved, on a week where nothing happened, and it stays through Previous, This week and swipes until they drag again.
  - **Fix:** Clear moveError and requestsError in the existing afterNavigate callback on non-shallow navigations, or key them to the week shown.
- [ ] **#95 Low** A dropped day shows nothing until the move returns, and a repeat drag then blames 'someone' for the person's own move
  - **Where:** `src/routes/(app)/menu/+page.svelte:238`, `src/routes/(app)/menu/+page.svelte:245`, `src/routes/(app)/menu/+page.svelte:264`, `src/lib/server/data/dinners.ts:630`
  - **Problem:** On a slow connection someone drags Monday onto Wednesday, sees nothing change, and drags again. The second move fails the shown-dinner check and the page says someone else changed the day, though it was their own first drag.
  - **Fix:** Keep a moving state from release until submitMove finishes: mark both days (aria-busy on the list, dimmed rows) and ignore new drags meanwhile, or show the swap at once and roll it back on failure.
- [ ] **#96 Low** Two quick swipes while the next week loads move only one week, with nothing showing the first swipe was taken
  - **Where:** `src/routes/(app)/menu/+page.svelte:195`, `src/routes/(app)/menu/+page.svelte:310`, `src/routes/(app)/menu/+page.svelte:314`
  - **Problem:** On a weak phone signal someone swipes twice to look two weeks ahead. Nothing moves for a moment, then only next week shows, against 'one week per swipe'.
  - **Fix:** Track the week being shown or loaded on the client, set it on each swipe and compute the next target from it, and show that a week is loading (for example dim the days while navigating from $app/state is set).
- [ ] **#97 Low** Move to another date's button leaves out the year, so Dec 31 next year reads 'Move to Fri, Dec 31'
  - **Where:** `src/lib/components/MoveDinner.svelte:98`, `src/lib/dates.ts:19`
  - **Problem:** Moving New Year's Eve dinner, a slip in the date input's year field sends it a year away, and the button confirming it looks like this year's date.
  - **Fix:** Use formatDateLabel(to, { today }) with the page's today (or the dinner's date) so a date in another year shows its year.
- [ ] **#98 Low** In the Request a dish sheet, the suggestions cover the Note field and the Request button and overflow the sheet
  - **Where:** `src/routes/(app)/menu/+page.svelte:444`, `src/lib/components/ItemInput.svelte:171`
  - **Problem:** On a phone with the keyboard up, a person types part of a dish name and wants to add a note or tap Request; the list hides both, and a tap where Request was picks a different dish instead.
  - **Fix:** Give the sheet's ItemInput a children snippet so its list shows in the sheet under the field, as the dinner page's dish field does since MEA-56, or cap the list's height inside sheets.
- [ ] **#99 Low** At 320 px wide, each dish's remove button drops onto its own line and the four type buttons stack one per row
  - **Where:** `src/lib/components/DinnerDishes.svelte:388`, `src/lib/components/DinnerDishes.svelte:400`, `src/lib/components/DinnerEditor.svelte:292`
  - **Problem:** On a small phone, or a phone set to larger display zoom, the dish list doubles in height and each remove button floats under its name near the next row, and the types take four rows before the dishes.
  - **Fix:** Let the dish name shrink (flex-basis 0 with min-width 0) so the role select and remove stay on its line, and lower the type buttons' minimum column to about 8rem so they stay two by two at 320 px.

### Recipes

- [ ] **#100 Medium** Import recipes crashes to 'Something went wrong' when a column header appears three or more times
  - **Where:** `src/routes/(app)/recipes/import/+page.svelte:69`, `src/lib/server/recipe-import.ts:127`
  - **Problem:** A household whose spreadsheet has several columns all headed 'Ingredients' or 'Steps' tries Import. Instead of a fixable list of problems they get an error page with no app header or tabs.
  - **Fix:** In readFile, report a repeated column once (remember which columns were already reported), and key the problems list by index instead of by its text.
- [ ] **#101 Low** The import summary says 'Imported 0 recipes' instead of leaving out the zero part
  - **Where:** `src/routes/(app)/recipes/+page.svelte:32`
  - **Problem:** Someone re-imports a corrected file and replaces all 3 recipes. Recipes says 'Imported 0 recipes and replaced 3.', which reads as if nothing was imported.
  - **Fix:** Leave out the Imported part when it's 0 and start with the first non-zero part, such as 'Replaced 3 recipes.' or 'Skipped 4 recipes.'
- [ ] **#102 Low** After Remove ingredient, focus lands on a button with the same name, so a second press deletes the next row
  - **Where:** `src/lib/components/RecipeIngredients.svelte:95`, `src/lib/components/RecipeIngredients.svelte:32`, `src/lib/components/RecipeIngredients.svelte:133`
  - **Problem:** A screen reader or keyboard user presses Remove ingredient 2 and hears 'Remove ingredient 2, button' again, so it sounds as if nothing happened. Pressing again deletes the next ingredient, with its amount, unit and prep note. A quick double tap on the ✕ can do the same, since the next row's ✕ moves into its place.
  - **Fix:** Announce the removal in a polite live region, such as 'Removed ingredient 2, Ground beef', and offer Undo for a row that had text. Keeping focus on a button, so the phone's keyboard stays closed, is fine once the change is announced.
- [ ] **#103 Low** Cancel in the editor and Back to recipe in the cooking view add a Back step, so Back reopens the page just left
  - **Where:** `src/lib/components/RecipeForm.svelte:362`, `src/routes/(app)/recipes/[id]/edit/+page.svelte:20`, `src/routes/(app)/recipes/[id]/cook/+page.svelte:67`, `src/routes/(app)/recipes/import/+page.svelte:157`
  - **Problem:** After cooking, someone taps Back to recipe, then the phone's Back to get to the list, and the cooking view opens again. After Cancel in the editor, Back shows the editor again. Cancel also drops the servings the recipe was shown at, so 6 servings becomes 4.
  - **Fix:** Make Cancel and Back to recipe go back in history when the page before was that page, as finish() does for Save. Otherwise, replace the history entry. Pass the servings shown through to the editor's cancelHref.
- [ ] **#104 Low** Step warnings miss fractions written with the fraction slash or spaced, so 'Simmer 1 1⁄2 hours' is flagged
  - **Where:** `src/lib/steps.ts:19`, `src/lib/steps.ts:21`, `src/lib/amounts.ts:33`, `src/lib/ingredient-text.ts:37`
  - **Problem:** A recipe imported from a site that writes fractions with the fraction slash has the step 'Simmer 1 1⁄2 hours'. Scaled to 6 servings, the step says 'Amounts in this step aren't scaled.' though it holds only a time: the always-on warning that change 2.1.3 meant to avoid.
  - **Fix:** In stepHasUnscaledAmount, replace U+2044 with '/' before matching, as parseAmount does, and allow spaces around the slash in the mixed-number form ((?:\s+|-)\d+\s*/\s*\d+). Add these cases to steps.spec.ts.
- [ ] **#105 Low** A Source with words after its web address becomes a broken link, since the whole text is the href
  - **Where:** `src/lib/recipe-view.ts:46`, `src/routes/(app)/recipes/[id]/+page.svelte:261`
  - **Problem:** Someone pastes a recipe's address into Source and adds a few words after it, such as '(we halve the sugar)' or '- Grandma's version'. The Recipe page shows it as a link, and tapping it opens the site's not-found page.
  - **Fix:** Link only a source that is a single address (/^https?:\/\/\S+$/i), or link just the leading address and show the rest as text. Add the case to recipe-view.spec.ts.
- [ ] **#106 Low** At 320 px wide, the Recipes heading runs under the Import button, and an ingredient's prep-note field shrinks to 74 px
  - **Where:** `src/routes/(app)/recipes/+page.svelte:99`, `src/lib/components/RecipeIngredients.svelte:271`, `src/lib/components/RecipeIngredients.svelte:281`
  - **Problem:** On a small phone the page title is clipped by its own buttons ('Archived recipes' even more), and typing 'finely chopped' in a prep note scrolls inside a field about eight characters wide.
  - **Fix:** Let the title row wrap (or put Import and New recipe on their own row below about 360 px), and below that width put the prep note on its own line or let amount and unit shrink.

### Shell, sheets, help and static pages

- [ ] **#107 Medium** The More menu stays open until More is tapped again; tapping elsewhere or Escape doesn't close it
  - **Where:** `src/routes/(app)/+layout.svelte:35`, `src/routes/(app)/+layout.svelte:12`
  - **Problem:** A person opens More, decides they don't need it and taps the page to dismiss it: the menu stays over the add bar, and their next tap there lands on History, Admin or Sign out instead of Add.
  - **Fix:** While the menu is open, close it on a pointerdown outside it and on Escape (a small document listener), returning focus to the summary.
- [ ] **#108 Low** Opening /feedback in the browser crashes with a 500 because Help has no entry for that route
  - **Where:** `src/lib/components/Help.svelte:10`, `src/lib/help.ts:158`, `src/routes/(app)/feedback/+page.server.ts:30`
  - **Problem:** Someone who reaches /feedback (an autocompleted URL, a bookmark, or a feedback form submitted before the page's script started) gets an error page; in the no-JS case the ticket was created, so they retry and send duplicates.
  - **Fix:** Give the feedback route a load that redirects to /groceries, so GET and post-action renders leave the route, or have Help render nothing for routes that HelpRouteId excludes instead of throwing.
  - **Verifier's correction:** Correction to the scenario: the sheet's form sits in a closed dialog that opens only through showModal after the script starts, and enhance never puts /feedback in the address bar or history. So a submit before the script starts, an autocompleted URL or a bookmark cannot reach it, and the duplicate-ticket path cannot happen from the UI. Only someone who types /feedback sees the 500. The fix is tiny (a load that redirects, or Help tolerating the route), and very few people will ever see it.
- [ ] **#109 Low** On a computer, a text selection that ends over the backdrop closes the sheet and discards edits
  - **Where:** `src/lib/components/Sheet.svelte:25`
  - **Problem:** On a laptop, someone edits a line's note, drags to select a word and lets go just outside the sheet: the sheet closes and what they typed is gone. Every Sheet in the app shares this.
  - **Fix:** Close on the backdrop only when the pointerdown also started on the dialog itself (remember the pointerdown target).
  - **Verifier's correction:** correction: the Feedback sheet closes too but keeps its message, since `message` is component state that survives closing (Feedback.svelte:16, 23, 70). So typed text is lost only in sheets rebuilt on open: the grocery edit sheet and duplicate prompt, Items edit (items/+page.svelte:20, 89) and Household's store edit (household/+page.svelte:20, 163). It happens only with a mouse, since touch selection doesn't fire this click. Design 7 (Help) says the sheet closes on a tap on the backdrop, and a drag that ends there is not a tap. Not MEA-43, which covers Escape and the Menu's jumps. Output is in (review script)
- [ ] **#110 Low** Admin's household 'Since' dates render in the server's locale and time zone, then change after load
  - **Where:** `src/routes/(app)/admin/+page.svelte:7`, `src/routes/(app)/admin/+page.svelte:66`
  - **Problem:** The admin opens Admin and the dates flicker to another format and, for evening sign-ups, to a different day; none match the date style used elsewhere.
  - **Fix:** Format on the server with formatDateLabel(dateIn(createdAt, household time zone)) and send the string, as Items does for its last-bought date.
- [ ] **#111 Low** Open sheets don't stop the page behind from scrolling
  - **Where:** `src/lib/components/Sheet.svelte:42`
  - **Problem:** On a phone, someone drags on the edit sheet to reach its Delete button. The list behind slides instead, and when the sheet closes, the list is somewhere else or jumps back as focus returns to the row.
  - **Fix:** While any sheet is open, lock the page with `:root:has(dialog[open]) { overflow: hidden; }` and give the dialog `overscroll-behavior: contain`.
- [ ] **#112 Low** The privacy page's 'Last updated' date is stale and it doesn't mention ratings shown by name
  - **Where:** `src/routes/privacy/+page.svelte:7`, `src/routes/privacy/+page.svelte:22`
  - **Problem:** A member reading the privacy page sees a date older than its content and isn't told that their ratings are stored and shown to the household by name.
  - **Fix:** Add ratings and who gave them to 'What Meals stores', and update the date whenever the text changes.
  - **Also covers:** The privacy page leaves out the Google ID, browser storage and what survives removal, and says backups last 14 days
- [ ] **#113 Low** Help for Recipe says nothing about Tried it, stars or the ratings list, and Help for Recipes leaves out Sort
  - **Where:** `src/lib/help.ts:86`, `src/lib/help.ts:58`
  - **Problem:** Someone opens Help on a recipe to learn what the stars and the names under them mean, or whether their stars are shared, and finds nothing. Help on Recipes doesn't say the list can be sorted by rating.
  - **Fix:** Add a point to Help: Recipe, such as 'Tried it and your stars save as soon as you tap them. Tap your star again to clear it. Everyone's ratings are listed under them.' Drop the ‹ Recipes clause to stay near 6 points. Mention Sort in Help: Recipes.
  - **Also covers:** Help for Recipe and Recipes predates ratings, Tried it and Sort, and mentions none of them

### Accessibility

- [ ] **#114 Medium** After a keyboard check-off, star, Tried it or Add store, focus jumps to the top of the page
  - **Where:** `src/routes/(app)/groceries/+page.svelte:136`, `src/routes/(app)/groceries/+page.svelte:147`, `src/routes/(app)/groceries/+page.svelte:335`, `src/routes/(app)/recipes/[id]/+page.svelte:90`
  - **Problem:** A keyboard or screen reader user checks off eight groceries. After each Enter on a circle, focus is back at the start of the page, so reaching the next item means tabbing through Meals, Help, More, Items, History and the whole add bar again. A screen reader that follows focus jumps to the top each time. The same happens with a recipe's stars and Tried it, and when adding several stores on Household.
  - **Fix:** After `update()`, focus the matching control, as the dinner page does. Give each line's check button a stable id (such as `check-<line id>`) and focus it, or the next line's, once the list re-renders. On the recipe page, focus the tapped star or the Tried it box again, and on Household, the store field. A shared enhance helper could cover all of these: it remembers the focused element's id and restores it when focus ends up on body.
  - **Also covers:** Checking off, undoing or marking a line ordered sends keyboard focus to the top of the page
- [ ] **#115 Medium** Keyboard focus lands hidden under the fixed tab bar or sticky header when tabbing through long pages
  - **Where:** `src/app.css:55`, `src/routes/(app)/+layout.svelte:88`, `src/routes/(app)/+layout.svelte:199`, `src/lib/components/Feedback.svelte:87`
  - **Problem:** A keyboard user on a computer, or on a phone with a keyboard, tabs down Groceries. When the next row is in the bottom 56 px, it's still inside the viewport, so the browser doesn't scroll, and the focused row and its ring stay behind the tab bar (WCAG 2.2 2.4.11 Focus Not Obscured). Going back up with Shift+Tab, rows land behind the header.
  - **Fix:** Add scroll padding to the root in app.css, for example `html { scroll-padding-top: calc(3.5rem + env(safe-area-inset-top)); scroll-padding-bottom: calc(var(--tabs-height) + var(--feedback-size) + 1.5rem + env(safe-area-inset-bottom)); }`. Focus scrolling and scrollIntoView then keep elements clear of the header, tab bar and feedback button.
- [ ] **#116 Low** In Windows high contrast mode, the chosen type, current tab, selected tag and active suggestion look unselected
  - **Where:** `src/lib/components/DinnerEditor.svelte:302`, `src/routes/(app)/+layout.svelte:226`, `src/app.css:281`, `src/lib/components/ItemInput.svelte:213`
  - **Problem:** With a Windows contrast theme, someone opens a dinner. Cooking at home, Eating out, Bringing a dish and Leftovers look the same, so they can't see which type is set. On Recipes they can't see which tags filter the list, the tab bar doesn't show which tab they're on, and arrowing through suggestions shows no highlight.
  - **Fix:** Add `@media (forced-colors: active)` rules that mark these states with system colors, for example `button[aria-pressed='true'], .chip[aria-current='true'], li[aria-selected='true'] { forced-color-adjust: none; background: SelectedItem; color: SelectedItemText; }`. Draw the current tab's bar with `border-top` instead of box-shadow.
- [ ] **#117 Low** After Send, the Feedback sheet drops focus and its Thanks message isn't announced to screen readers
  - **Where:** `src/lib/components/Feedback.svelte:58`, `src/lib/components/Feedback.svelte:72`, `src/lib/components/Feedback.svelte:79`
  - **Problem:** A screen reader user sends feedback, and nothing is spoken after Send. They can't tell whether it went, so they may send it again. Typing past 2,000 characters stops without a word.
  - **Fix:** Keep an always-present `role="status"` element in the sheet, and put the thanks line and the limit warning in it. Alternatively, focus the thanks message (tabindex=-1) or Close once the feedback is sent.
  - **Also covers:** After Send, focus drops to the page and 'Thanks, your feedback was sent.' is never announced; After Send, focus drops out of the feedback sheet and 'Thanks, your feedback was sent.' isn't announced
- [ ] **#118 Low** Requested dish links on the Menu and a date's page are 25 px tall, under the 44 px tap target
  - **Where:** `src/routes/(app)/menu/+page.svelte:413`, `src/lib/components/DayRequests.svelte:179`, `src/routes/(app)/menu/+page.svelte:700`, `src/lib/components/DayRequests.svelte:284`
  - **Problem:** On a phone, someone taps a requested dish's name to open its recipe and hits the note or the 'Asked by' line instead. On the Menu, the miss lands near Remove, which deletes the request at once.
  - **Fix:** Give these links the app's `link-tap` class (inline-flex with min-height var(--tap)), as DinnerDishes.svelte does for its dish links.
  - **Verifier's correction:** Correction: Remove sits beside the text column (.request is a row, 687-691), not under the link, so a vertical miss lands on the note or the 'Asked by' text, which does nothing. The scenario's claim that a miss can delete the request is overstated. The link does pass WCAG 2.5.8's 24 px minimum.
- [ ] **#119 Low** Searching Recipes, Items, History or Copy a dinner updates the list with nothing announced to screen readers
  - **Where:** `src/lib/components/SearchBox.svelte:45`, `src/routes/(app)/recipes/+page.svelte:178`, `src/routes/(app)/groceries/items/+page.svelte:63`, `src/routes/(app)/groceries/history/+page.svelte:22`
  - **Problem:** A screen reader user types 'pie' in Recipes. The list narrows to two recipes, or to 'No recipes matching pie.', but nothing is spoken (WCAG 4.1.3 Status Messages). To find out whether anything matched, they have to leave the box and explore.
  - **Fix:** Give each searchable list an always-present, visually hidden role="status" region. After each search, it says the result, such as '12 recipes' or the no-matches sentence.
  - **Verifier's correction:** Correction: Copy a dinner (CopyDinner.svelte:130-164) filters on every keystroke rather than 300 ms after typing stops; it also has no live region. This fails WCAG 4.1.3.
  - **Also covers:** Search results on History and Items are never announced; the first search only announces the page name
- [ ] **#120 Low** Saved and Invited messages appear in live regions created with their text, which screen readers often skip
  - **Where:** `src/routes/(app)/household/+page.svelte:40`, `src/routes/(app)/household/+page.svelte:108`, `src/routes/(app)/admin/+page.svelte:42`, `src/routes/(app)/recipes/+page.svelte:105`
  - **Problem:** A screen reader user saves the household's settings or invites someone. The confirmation shows, but its live region is inserted together with the text while focus jumps to the start of the page, and VoiceOver and NVDA commonly say nothing in that case.
  - **Fix:** Render these status elements always, empty until there's a message, as the Menu's savedStatus snippet does, and set only their text after the save.
  - **Notes:** Likely, not fully proven
- [ ] **#121 Low** Body text is fixed at 17px, so a larger browser font size grows headings but not list text or fields
  - **Where:** `src/app.css:63`
  - **Problem:** Someone with low vision has set their browser's font size to Large or Very large and opens Meals on a computer. Headings and padding grow, but grocery lines, recipe text and form fields stay at 17px.
  - **Fix:** Use a relative size, `font: 1.0625rem/1.5 var(--font-body)` (17px at the default 16px), so body text follows the font size setting like the rest of the page.
- [ ] **#122 Low** Each sheet's title row is a header element, so screen readers find a banner landmark inside every sheet
  - **Where:** `src/lib/components/Sheet.svelte:31`
  - **Problem:** With a sheet open, a screen reader user lists landmarks and gets a 'banner' that is only the sheet's title and Close button. On the Help sheet, it's a banner inside the page's banner.
  - **Fix:** Use a plain `<div class="head">` for the title row in Sheet.svelte.
- [ ] **#123 Low** The rating '★ 4.5 (2)' has no spoken form, so screen readers hear 'black star 4.5, 2'
  - **Where:** `src/lib/recipe-view.ts:101`, `src/routes/(app)/recipes/[id]/+page.svelte:130`, `src/routes/(app)/recipes/+page.svelte:169`
  - **Problem:** A screen reader user browsing Recipes hears 'black star 2, 1' for each rated recipe, and can't tell that it means an average of 2 from one rating.
  - **Fix:** Mark the visual '★ 4.5 (2)' aria-hidden and add visually hidden words such as 'Rated 4.5 by 2 people', for example in a small component used where formatRating is shown.
  - **Also covers:** The '★ 4.5 (2)' rating has no accessible text, so screen readers can't tell it's an average of 2 ratings
- [ ] **#124 Low** The edit sheet has two buttons both named Save, one for the edits and one for Got fewer
  - **Where:** `src/routes/(app)/groceries/+page.svelte:511`, `src/routes/(app)/groceries/+page.svelte:538`
  - **Problem:** With Got fewer open, a screen reader user hears two 'Save' buttons, and a tired shopper taps the big primary Save, which saves the edits but records nothing as received.
  - **Fix:** Name the second button for what it does, such as 'Save received', and show its error beside the How many did you get? field.
- [ ] **#125 Low** Store group headers announce the decorative triangle and an unlabeled count
  - **Where:** `src/routes/(app)/groceries/+page.svelte:276`, `src/routes/(app)/groceries/+page.svelte:605`
  - **Problem:** A screen reader reads each store as 'black right-pointing small triangle, Aldi, 5' without saying what the 5 counts.
  - **Fix:** Use content: '▸' / '' (or an aria-hidden element) for the triangle, and give the count words, such as a visually hidden 'left to get'.
- [ ] **#126 Low** Every day link's accessible name ends with the decorative › arrow
  - **Where:** `src/routes/(app)/menu/+page.svelte:564`
  - **Problem:** A screen reader user moving through the week hears every day end with the arrow glyph read out (for example 'single right-pointing angle quotation mark'), seven times per week.
  - **Fix:** Give the generated content empty alt text (content: '›' / '';) or draw the arrow with an aria-hidden element.
- [ ] **#127 Low** Remove gives no confirmation: focus jumps to Request a dish, and same-name requests share one label
  - **Where:** `src/routes/(app)/menu/+page.svelte:278`, `src/routes/(app)/menu/+page.svelte:289`, `src/routes/(app)/menu/+page.svelte:423`
  - **Problem:** A screen reader user removes a request and hears 'Request a dish, button' with nothing saying it was removed, then has to go back up the list for the next one. If Sam and Brian both asked for Lasagna, both buttons are 'Remove Lasagna'.
  - **Fix:** Announce 'Removed Lasagna.' in a status line, move focus to the next request's Remove (or the Requests heading when none are left), and include the asker in the label ('Remove Lasagna, asked by Sam').
- [ ] **#128 Low** Arrow keys on a dish's role select save only the first step and snap the select back
  - **Where:** `src/lib/components/DinnerDishes.svelte:302`, `src/lib/components/DinnerDishes.svelte:131`, `src/lib/components/DinnerDishes.svelte:140`
  - **Problem:** A keyboard user on Windows or Linux presses Down twice to change a dish from Side to Other. Only Dessert is saved, the select jumps back to Dessert, and the row moves away while they're using it.
  - **Fix:** Save the role on blur or after a short pause rather than on every change event, or keep the latest value and send it when the request in flight finishes, instead of dropping it.
- [ ] **#129 Low** On a date with several dinners, each 'Dishes' heading is at the same level as its dinner's label
  - **Where:** `src/lib/components/DinnerDishes.svelte:279`, `src/lib/components/DinnerEditor.svelte:198`
  - **Problem:** A screen reader user moving through headings hears Kids, Dishes, Adults, Requests as equals, so it isn't clear which dinner each Dishes list belongs to.
  - **Fix:** Give DinnerDishes a heading-level prop and render 'Dishes' as h3 when the dinner is labeled (h2 otherwise).
- [ ] **#130 Low** The dish combobox doesn't announce an added dish, and Down Arrow can't reopen the suggestions
  - **Where:** `src/lib/components/DinnerDishes.svelte:183`, `src/lib/components/ItemInput.svelte:96`, `src/lib/components/ItemInput.svelte:140`
  - **Problem:** A screen reader user picks a dish with Enter. The field just empties, with no 'Added Chicken tacos'. After pressing Escape, they have to retype to get the suggestions back.
  - **Fix:** Announce 'Added <dish>.' in a polite status region in the Dishes section, open the list on Down Arrow (or Alt+Down) when the field has text, and give the listbox aria-label 'Dish suggestions'.
  - **Verifier's correction:** Correction: the Down Arrow and listbox-name problems are in the shared ItemInput, so they also affect the grocery add bar, recipe ingredient rows and the request sheet, not only the dish field.
- [ ] **#131 Low** Household, Admin and store groups have bare Edit, Remove, Cancel and Mark all buttons that don't name their target
  - **Where:** `src/routes/(app)/household/+page.svelte:140`, `src/routes/(app)/household/+page.svelte:81`, `src/routes/(app)/household/+page.svelte:117`, `src/routes/(app)/household/+page.svelte:153`
  - **Problem:** A screen-reader user brings up the list of buttons to rename Costco and hears 'Edit, Edit, Edit, Edit'. Or they tab to 'Cancel' without hearing which invite it cancels.
  - **Fix:** Put the target in the accessible name, as the circles do: aria-label='Edit Costco', 'Cancel invite for …', 'Remove Bob Lopez', 'Restore …' and 'Mark all Aldi items ordered'. ConfirmButton can take an optional ariaLabel for this.

### Frontend code health

- [ ] **#132 Low** The dinner page's components repeat the same submit and failure handling and run typed-form state through pass-through methods
  - **Where:** `src/lib/components/DinnerEditor.svelte:82`, `src/routes/(app)/menu/[date]/+page.svelte:106`, `src/lib/components/AddDinner.svelte:40`, `src/lib/components/DayRequests.svelte:116`
  - **Problem:** Each fix to the busy, failure or reload handling (such as the overlapping-change race) has to be made in seven places. The rules for keeping typed text (reconcile, matches, hasUnsaved) live in Svelte components called imperatively during $effect.pre, so they can only be tested through the browser.
  - **Fix:** Extract a shared failureMessage(result) and one page-level change runner (busy flag, refresh, own-change tracking) that every form uses, plus a DinnerLabels fields component. Keep each dinner's typed fields in a plain state object the page owns, so reconcile can be unit tested.
- [ ] **#133 Low** The 730-line week page repeats near-identical request handlers that already diverged, and copies DayRequests' list
  - **Where:** `src/routes/(app)/menu/+page.svelte:65`, `src/routes/(app)/menu/+page.svelte:107`, `src/routes/(app)/menu/+page.svelte:141`, `src/routes/(app)/menu/+page.svelte:278`
  - **Problem:** The next change to requests (MEA-44 screenshots, a new field) has to be made in three handlers and two lists, and one copy gets missed, as navigate: false already was.
  - **Fix:** Extract a RequestSheet component or one submit helper that always applies results in place, a shared RequestSummary for the week and DayRequests, a shared failureMessage in #lib, and move swipe and drag into Svelte actions.
  - **Verifier's correction:** Corrections: (1) groceries/+page.svelte:23 and DinnerDishes.svelte:49 have their own failure helpers, so 'failureMessage exists only on this page' is true of the name only. (2) MEA-44 ('Feedback: Add screenshot to request') is about feedback, not menu requests. (3) About 215 of the 730 lines are CSS. The user-facing bug is already MEA-43; this finding's value is fixing it in one shared place. Lowered to low because the duplication stays within two components.
- [ ] **#134 Low** ItemInput's comment says a dish request offers no new option, but the request sheet offers one, as 6.12 says
  - **Where:** `src/lib/components/ItemInput.svelte:10`, `src/routes/(app)/menu/+page.svelte:450`
  - **Problem:** A developer who trusts the comment passes noun={null} for requests and removes the new-dish option that 6.12 requires.
  - **Fix:** Change the comment to say the request field offers a new dish, which the request adds to Recipes (6.12).
- [ ] **#135 Low** Two unrelated .label rules style both the week range and each dinner's label
  - **Where:** `src/routes/(app)/menu/+page.svelte:520`, `src/routes/(app)/menu/+page.svelte:643`, `src/routes/(app)/menu/+page.svelte:308`, `src/routes/(app)/menu/+page.svelte:389`
  - **Problem:** On a day with Kids and Adults dinners, each label sits 8 px away from the dinner it names, so 'Kids' reads apart from 'Cooking at home'. The week range takes the dinner label's heading font at 600 instead of the 700 its own rule sets.
  - **Fix:** Rename one class (for example week-label and dinner-label) so each rule styles only its own element.
- [ ] **#136 Low** RecipeForm's failure prop and the new and edit pages' form plumbing never run, since every save uses the script
  - **Where:** `src/lib/components/RecipeForm.svelte:21`, `src/lib/components/RecipeForm.svelte:137`, `src/routes/(app)/recipes/new/+page.svelte:77`, `src/routes/(app)/recipes/[id]/edit/+page.svelte:21`
  - **Problem:** A maintainer reads 'A failure from a save that didn't go through this page's script' and assumes a save path without the script exists. They then keep both paths in step when changing failures such as archivedId or archivedItems, for code that never runs.
  - **Fix:** Remove the failure prop, the untrack(() => failure) seed and the form plumbing in both pages. If a save without the script is actually wanted, stop disabling Save before hydration and add a test for it.

## 3. Potential UI/UX improvements

### Groceries

- [ ] **#137 Medium** Let people add a store from the 'Where did you get it?' sheet instead of sending them to Household
  - **Where:** `src/routes/(app)/groceries/+page.svelte:446`, `src/routes/(app)/groceries/+page.svelte:266`
  - **Problem:** On a new household's first trip, the first tap on a circle in the store is a dead end: leave the list, find Stores on Household, add one, come back and tap again. The same happens the first time they shop at any new store.
  - **Fix:** Add a 'New store' field to the picker (and to the edit sheet's store choice) that creates the store and checks the line off in one step, and mention stores in the first-run empty state.
  - **Verifier's correction:** correction: the 'any new store' case only blocks lines with no store. A line that has a default store checks off at that store without asking (needs.ts storeForStatusChange). A cheap first step is to mention stores in the empty state and Help. Inline creation would also need the name and archived-name rules (6.10). Not covered by any open MEA ticket.
- [ ] **#138 Low** Items shows an archived store as an item's store, though adding the item then fills in no store
  - **Where:** `src/lib/server/data/items.ts:108`, `src/routes/(app)/groceries/items/+page.svelte:72`
  - **Problem:** Someone checks Items to see where Milk is bought and sees Aldi. They add Milk, and it lands under No store with nothing to explain why.
  - **Fix:** Return the default store's archived state from listCatalog and show it, for example 'Aldi (archived)', or show 'No store yet' to match what the add bar does.
- [ ] **#139 Low** Show each line's note, such as a substitution, in History
  - **Where:** `src/routes/(app)/groceries/history/+page.svelte:29`
  - **Problem:** Someone checks History to see what they actually got last time and can't see that the store substituted something else.
  - **Fix:** Render line.note under the item in History, as the list does, and label today's and yesterday's groups.
- [ ] **#140 Low** Give the grocery list a print layout
  - **Where:** `src/app.css:338`, `src/routes/(app)/groceries/+page.svelte:216`, `src/routes/(app)/groceries/+page.svelte:281`
  - **Problem:** A family member who shops without a phone gets a printout that starts with an empty form and buttons, and is missing every store someone had collapsed.
  - **Fix:** Mark the add bar, title links and group actions no-print, print every group open, and keep the circles as boxes to tick by hand.
- [ ] **#141 Low** Names match with accents, so typing 'jalapeno' misses 'Jalapeño' and adds a second item
  - **Where:** `src/lib/text.ts:7`, `src/lib/components/ItemInput.svelte:52`, `src/lib/server/data/items.ts:37`, `src/lib/server/data/items.ts:120`
  - **Problem:** A recipe imported from a site has 'Jalapeño'. Later someone types 'jalapeno' on the grocery list, because an ñ takes a long press on a phone. Once the n is typed, no suggestion matches and 'Add new item' is offered. Add creates a second item with its own default store and history, and gives no 'already on the list' warning. Searching Items, History or Recipes for 'creme brulee' finds nothing, and typing it on a dinner and tapping Add creates a new empty dish beside the 'Crème brûlée' recipe.
  - **Fix:** Add a separate accent-free key (foldCase, then NFD with \p{M} removed) for ItemInput's suggestions and the instr() searches, and keep fold() for name equality. Treating names that differ only in accents as one item would change 2.3's 'ignoring case', so that part needs a design decision.

### Menu and dinners

- [ ] **#142 Medium** After Save, the week opens at its top, so the 3-second Saved line for a later day is off screen
  - **Where:** `src/routes/(app)/menu/+page.svelte:23`, `src/routes/(app)/menu/+page.svelte:382`, `src/routes/(app)/menu/[date]/+page.server.ts:228`
  - **Problem:** On a phone, change Thursday's note and tap Save. The week opens at Sunday; the only sign the save worked, 'Saved' on Thursday, appears and disappears two screens down, so people scroll to check or reopen the day.
  - **Fix:** When afterNavigate finds ?saved=, scroll that dinner's day into view after tick (scrollIntoView({ block: 'center' })), or redirect with a #day anchor and give each row an id.
- [ ] **#143 Low** Move to another date swaps silently: the sheet doesn't say the chosen date has a dinner, and nothing says where it went
  - **Where:** `src/lib/components/MoveDinner.svelte:90`, `src/lib/components/MoveDinner.svelte:72`, `src/routes/(app)/menu/[date]/+page.server.ts:324`
  - **Problem:** Someone moves Monday's tacos to Wednesday, forgetting Wednesday was pizza night. They land on Wednesday, see tacos and leave; pizza is now on Monday and nothing told them.
  - **Fix:** After a swap, say on the new date 'Pizza moved to Mon, Nov 9.' (for example from a flag on the redirect), and name the chosen date's dinners in the sheet before Move.
- [ ] **#144 Low** On a date with several dinners, the Clear sheet doesn't say which dinner it clears
  - **Where:** `src/lib/components/DinnerEditor.svelte:246`
  - **Problem:** On a Kids and Adults day the Clear sheet covers the page and reads the same for both dinners. Since the dinners also run together (see the separator finding), the person can't confirm which one goes.
  - **Fix:** Name the dinner on labeled dates, for example title 'Clear Kids?' and message 'Clear Kids? Its dishes stay in your recipes.'
- [ ] **#145 Low** Suggestions still offer dishes already on the dinner, which now fail as soon as they're picked
  - **Where:** `src/lib/components/DinnerDishes.svelte:337`, `src/routes/(app)/menu/[date]/+page.svelte:277`
  - **Problem:** With Rice already on the dinner, typing 'ric' still lists Rice first. Tapping it, which adds right away, gives an error instead.
  - **Fix:** Leave this dinner's own dishes out of its suggestions, or list them marked 'On this dinner' and not pickable.
- [ ] **#146 Low** At 5 dinners, Add a dinner disappears without saying why
  - **Where:** `src/routes/(app)/menu/[date]/+page.svelte:287`
  - **Problem:** A family with five dinners on a day looks for Add a dinner, finds nothing, and isn't told there's a limit.
  - **Fix:** In the button's place, show 'A day can have up to 5 dinners. Clear one to add another.' (the restaurant request Add already uses this wording).
- [ ] **#147 Low** The 'Add … as a new dish' suggestion doesn't add the dish
  - **Where:** `src/lib/components/ItemInput.svelte:77`, `src/lib/components/ItemInput.svelte:157`
  - **Problem:** Since MEA-56, picking a suggestion adds it, so people expect the last option, which says 'Add “Garlic bread” as a new dish', to add too. It only closes the list, and they have to notice that they still need to tap Add (see the finding about typed dish names being dropped).
  - **Fix:** Make the new-dish option add the dish, as the other suggestions do (the restore sheet still covers archived names). Or reword it so it doesn't promise to add, for example 'New dish: Garlic bread (tap Add)'.
  - **Notes:** Reopens design: design 7, Dinner (MEA-56): picking 'Add ... as a new dish' only fills it in
- [ ] **#148 Low** A requested dish already on the date's dinner can't be added or removed from that date's page, so the request lingers
  - **Where:** `src/lib/server/data/dinners.ts:383`, `src/lib/components/DayRequests.svelte:187`
  - **Problem:** Someone requests Lasagna after another member already put it on Friday. On Friday's page, Add says 'Lasagna is already on this dinner.', and the request stays on every week until someone finds it on the Menu and removes it.
  - **Fix:** Treat it as done: when the dish is already on the chosen dinner, remove the request and say 'Lasagna was already on this dinner, so the request is done.', or offer Remove in that message.
  - **Notes:** Reopens design: 6.12 (nothing changes when the dish is already on that dinner; no Remove on a date's page)
- [ ] **#149 Low** Copy a dinner doesn't show the type a past dinner will switch this one to
  - **Where:** `src/lib/components/CopyDinner.svelte:155`, `src/lib/server/data/dinners.ts:735`
  - **Problem:** Someone copies 'Brownies' onto a dessert night at home and the dinner quietly becomes Bringing a dish.
  - **Fix:** Show the type on groups whose latest dinner isn't Cooking at home (for example 'Bringing a dish · Made Fri, Oct 23').
  - **Notes:** Likely, not fully proven
- [ ] **#150 Low** Request a dish and Request a restaurant show nothing while sending
  - **Where:** `src/routes/(app)/menu/+page.svelte:42`, `src/routes/(app)/menu/+page.svelte:101`, `src/routes/(app)/menu/+page.svelte:133`, `src/routes/(app)/menu/+page.svelte:465`
  - **Problem:** On a slow connection the person taps Request, nothing changes, and they close the sheet thinking it failed or tap again; the request appears later. The app's Feedback sheet says 'Sending…' in the same situation.
  - **Fix:** Use the existing flags in the markup: disable the button and show 'Requesting…' (and 'Restoring…') while set.
- [ ] **#151 Low** Request sheets open with focus on Close rather than the Dish or Restaurant field
  - **Where:** `src/lib/components/Sheet.svelte:16`, `src/routes/(app)/menu/+page.svelte:444`, `src/routes/(app)/menu/+page.svelte:474`
  - **Problem:** A phone user taps Request a dish and has to tap again into the field before the keyboard opens; a screen reader user lands on the close button and must move on to find the only field that matters.
  - **Fix:** Let Sheet's showModal focus a descendant marked autofocus and mark the Dish and Restaurant inputs.
  - **Verifier's correction:** Correction: showModal() already focuses a descendant that has autofocus, so Sheet needs no change for that. Svelte flags autofocus (a11y_autofocus), so the fix needs a svelte-ignore or a focus target passed to Sheet. Feedback, Add a dinner and Copy a dinner behave the same way, so a convention set in Sheet may be better than a fix for requests only. Worth doing on phones: these sheets exist to type one name.
- [ ] **#152 Low** Request a dish and Request a restaurant stack on two lines on phones
  - **Where:** `src/routes/(app)/menu/+page.svelte:431`, `src/routes/(app)/menu/+page.svelte:719`
  - **Problem:** On a typical phone the two request buttons wrap into a ragged stack under the list.
  - **Fix:** As MEA-54 asks: a two-column grid with shorter labels, or smaller padding, so both fit 346 px.
  - **Notes:** MEA-54
- [ ] **#153 Low** Typed notes are lost without a question when a phone drops the tab in the background
  - **Where:** `src/routes/(app)/menu/[date]/+page.svelte:15`, `src/lib/components/DinnerDetails.svelte:173`
  - **Problem:** Someone types a long note, switches to a recipe site to copy a link, and the phone discards Meals in the background. Coming back reloads the page (Q11), and the note is gone with no question.
  - **Fix:** Export a snapshot from the dinner page that captures and restores each dinner's typed note, servings, label and restaurant (and the dish field), keyed by dinner id.
  - **Verifier's correction:** Fix correction: SvelteKit 3.0.0 deprecates `export const snapshot` (client.js:663-673, 'TODO 4.0 get rid of this'). Use `snapshot({ id, capture, restore })` from $app/navigation inside DinnerDetails, with an id per dinner, since a duplicate id errors in dev. It is saved to sessionStorage when the tab is hidden (client.js:3113-3116).
  - **Notes:** Likely, not fully proven
- [ ] **#154 Low** Help: Dinner doesn't mention several dinners or labels, and has 7 points
  - **Where:** `src/lib/help.ts:117`
  - **Problem:** A household that wants a kids' dinner and an adults' dinner can't learn from Help that Add a dinner exists, that it asks for labels, or that Move takes every dinner on the day.
  - **Fix:** Combine two points and add one, for example 'Add a dinner plans another for this day, such as Kids and Adults, up to 5. Moving the date moves them all.'

### Recipes and import

- [ ] **#155 Medium** Replace in Import recipes wipes every detail the file has no column for, and resets servings
  - **Where:** `src/lib/server/recipe-import.ts:142`, `src/lib/server/recipe-import.ts:88`, `src/lib/server/recipe-import.ts:296`, `src/lib/server/data/dishes.ts:211`
  - **Problem:** A household imports from a spreadsheet, then adds notes, nutrition and times in the app. Later they fix a few ingredient lines in a sheet that has only Recipe and Ingredients columns and choose Replace. The notes, steps, nutrition, times and tags are erased and servings fall back to the usual number. Neither the duplicates step nor Help warns about this, and there is no undo.
  - **Fix:** On Replace, keep the existing value for any column the file doesn't have, and say so in Help. At minimum, warn beside Replace that details missing from the file will be cleared.
  - **Notes:** Reopens design: Section 7, Import recipes: Replace swaps the existing recipe's details for the file's
- [ ] **#156 Medium** Import from a link silently replaces the whole editor, dropping a chosen photo, tags, notes and earlier edits
  - **Where:** `src/routes/(app)/recipes/new/+page.svelte:27`, `src/routes/(app)/recipes/new/+page.svelte:70`, `src/lib/components/RecipeForm.svelte:36`
  - **Problem:** Someone opens New recipe, takes a photo of the dish and types tags, then pastes the link and taps Import. The photo and tags disappear. In another case, someone imports, spends minutes fixing ingredients and adding notes, then taps Import again, which sits right next to the Link field. Everything goes back to the page's version, and nothing asks first.
  - **Fix:** When the editor has changes (RecipeForm's typed() differs from its start), ask before replacing them. Keep the photo, tags and notes the person already set, since the import never fills those in.
  - **Also covers:** Import from a link replaces everything in the editor, including a photo already chosen, without asking
  - **Notes:** Reopens design: Section 7, Import from a link: fields the page leaves out keep what a new recipe starts with
- [ ] **#157 Low** Recipes already in Recipes need one choice each; there's no Replace all or Skip all
  - **Where:** `src/routes/(app)/recipes/import/+page.svelte:97`
  - **Problem:** After fixing a spreadsheet, for example for the line-break problem above, re-importing 120 recipes that are all already in Recipes means tapping Replace 120 times on a phone.
  - **Fix:** Add 'Replace all' and 'Skip all' above the list to set every row's choice at once, keeping Rename per row.
- [ ] **#158 Low** The recipe editor reports one problem per save, at the top of the form, without marking the field
  - **Where:** `src/lib/server/recipe-form.ts:327`, `src/lib/components/RecipeForm.svelte:208`
  - **Problem:** On a phone, fixing a long recipe means: Save, read 'Ingredient 4 needs an item', scroll down to find row 4, fix it, scroll up, Save again, and repeat for each problem.
  - **Fix:** Return every problem at once (Import recipes already does), show each next to its field or ingredient row with aria-invalid, and focus the first one.
- [ ] **#159 Low** Scaled custom units keep the typed form, so recipes show '3 clove Garlic' and '1 cloves'
  - **Where:** `src/lib/scaling.ts:26`, `src/lib/units.ts:88`
  - **Problem:** Print-outs and the cooking view read wrong for the most common custom units (clove, can, slice, stick, head) whenever a recipe is scaled.
  - **Fix:** For the common units ingredient-text.ts already lists, show singular or plural by the shown amount, as unitLabel does for known units; leave other custom units as typed.
  - **Notes:** Reopens design: 6.6 'Custom units and counts are scaled and rounded the same way and keep their unit.'
- [ ] **#160 Low** Tag chips take four to five rows above the first recipe on a phone
  - **Where:** `src/routes/(app)/recipes/+page.svelte:125`
  - **Problem:** Every visit to Recipes on a phone opens on a wall of chips; as the household adds tags, the list itself is pushed off the first screen.
  - **Fix:** Show the chips in one horizontally scrolling row with selected tags first, or fold them behind a 'Tags' button with a count.
  - **Notes:** Likely, not fully proven
- [ ] **#161 Low** The editor shows every unused household tag as a 44 px chip under Tags, a full phone screen with 35 tags
  - **Where:** `src/lib/components/RecipeTags.svelte:32`, `src/lib/components/RecipeTags.svelte:61`
  - **Problem:** Every time someone edits a recipe on a phone, they scroll past a screenful of tag chips to reach the ingredients, even when they aren't changing tags. This is the editor's own list in RecipeTags. The Recipes list's tag chips were reported separately.
  - **Fix:** Show suggestions only while the Tags field has focus or text is typed in it. Alternatively, show the few most used tags with a 'More tags' toggle.
- [ ] **#162 Low** The cooking view's section headings are 13.6 px, smaller than the app's normal text, because they're sized in rem
  - **Where:** `src/lib/components/IngredientList.svelte:44`, `src/routes/(app)/recipes/[id]/cook/+page.svelte:118`
  - **Problem:** With the phone propped on the counter, 'FOR THE GLAZE' is the smallest text in the large-text cooking view. It's easy to miss which ingredients belong to the glaze.
  - **Fix:** Size IngredientList's h3 in em: 0.85em gives about 16.3 px in the cooking view and 14.5 px on the recipe page. Or give it a larger size under .cook.
- [ ] **#163 Low** Scaled recipes flag 'Preheat oven to 350.' and 'Bake at 350 for 25 minutes', since a bare temperature counts
  - **Where:** `src/lib/steps.ts:34`, `src/lib/steps.ts:37`
  - **Problem:** Hand-typed baking recipes often leave out the degree sign, which phone keyboards hide behind a long press or a symbols page. When such a recipe is scaled, 'Preheat oven to 350.' and 'Bake at 350 for 25 to 30 minutes.' are marked as having unscaled amounts, so the first step of most of these recipes carries the warning. Change 2.1.3 says an always-on warning gets ignored.
  - **Fix:** Also treat a whole number from about 200 to 550 as a temperature when it follows 'oven to', 'preheat to', 'bake at', 'roast at' or 'heat ... to', and say so in 6.7.
  - **Notes:** Reopens design: 6.7 (Q34): only numbers followed by °, degrees or a time word are skipped

### Sign-in, household and admin

- [ ] **#164 Low** The setup page has no sign-out and never says a family member can invite you instead, though setup can't be undone
  - **Where:** `src/routes/setup/+page.svelte:9`, `src/lib/server/data/households.ts:49`, `src/lib/server/data/households.ts:77`
  - **Problem:** The admin (on first sign-in) or someone the admin invited to start a household lands on /setup, but their partner already has a household. Nothing says the partner can invite this account and it will join right away (createInvite's 'joined' path), and there's no way to sign out or switch accounts. If they tap Create household, they become the only member of a new household and can never move. The partner's invite is refused, they can't remove themselves, and households can't be deleted.
  - **Fix:** On the setup page, show the signed-in email and a Sign out (POST /logout) or 'Use another account' link. Add a line such as 'Joining a household that already uses Meals? Ask a member to invite <email>, then reload this page.'
  - **Verifier's correction:** Correction: the admin's own first sign-in can't hit this, because no other household can exist before the admin sets one up. It applies to someone the admin invited to start a household whose family already uses Meals, or to an admin who was removed and signs in again. That is rare, so low instead of medium. The hint line and a Sign out button are cheap and concrete.
- [ ] **#165 Low** Admin page can't see people who signed in but never finished setup, and re-inviting them fails confusingly
  - **Where:** `src/lib/server/auth/sign-in.ts:42`, `src/lib/server/data/households.ts:77`, `src/routes/(app)/admin/+page.server.ts:25`, `src/routes/(app)/admin/+page.svelte:43`
  - **Problem:** The admin invites a new household. The person signs in, which deletes the invite, then leaves the setup page. They vanish from Admin: not under the pending invites and not under Households. Re-inviting says they already have an account, with no hint that they only need to sign in again and finish setup.
  - **Fix:** List accounts with no household on the Admin page (for example 'Signed in, not set up yet: email'). For that case, change the invite message to say they can sign in again to finish setting up.
- [ ] **#166 Low** After signing in, people always land on Groceries instead of the link they opened
  - **Where:** `src/lib/server/auth/guards.ts:9`, `src/routes/login/google/callback/+server.ts:42`
  - **Problem:** A member texts a recipe link (/recipes/12) or a searched list. The recipient isn't signed in (new phone, or a messaging app's built-in browser with its own cookies), signs in, and lands on Groceries, then has to find the recipe by hand.
  - **Fix:** Have requireUser redirect to /login?next=<path and query>, carry next through /login/google in a short-lived cookie, and after sign-in redirect to it only if it is a same-site path that starts with a single '/'.
- [ ] **#167 Low** The Remove member confirmation doesn't say the member's dish and restaurant requests will be deleted
  - **Where:** `src/routes/(app)/household/+page.svelte:83`, `src/lib/server/db/schema.ts:418`
  - **Problem:** Someone removes a member to tidy up the household and is surprised that everything that person asked for has vanished from the Menu's Requests. Nothing on the confirmation warned them.
  - **Fix:** Add 'Their dish and restaurant requests will be removed.' to the confirmation, and mention ratings once MEA-33 settles what happens to them.
- [ ] **#168 Low** The Admin page shows the newest backup's date without its age, and doesn't warn when nightly backups stop
  - **Where:** `src/routes/(app)/admin/+page.svelte:19`, `src/lib/server/backups.ts:5`, `docs/design.md:241`
  - **Problem:** If the cron job starts failing on Oct 30, on Nov 3 the Admin page still reads 'Last nightly backup: Fri, Oct 30' in normal text. The admin has to know today's date and the schedule to see that something is wrong. A backup that stopped last December reads 'Wed, Dec 31' in January, as if it were recent.
  - **Fix:** Show the age, such as '4 days ago', and use the error style when the newest backup is more than about a day and a half old. Pass today to formatDateLabel so an earlier year is shown.
- [ ] **#169 Low** Make error pages friendlier and keep the app's header and tabs on them
  - **Where:** `src/routes/+error.svelte:5`
  - **Problem:** Someone follows a shared link to a recipe that was removed and sees a repeated, technical message with no tabs to reach Recipes or Menu.
  - **Fix:** Add an (app)/+error.svelte so signed-in errors keep the layout, and write the message in plain words, such as 'That page isn't here. It may have been removed.', instead of repeating the heading or showing 'Internal Error'.
  - **Verifier's correction:** Correction: recipes are archived, never deleted (E3; dishes.ts has no delete), so 'a recipe that was removed' can't happen. The realistic cases are a link from another household, a bad date, the hidden /pantry, or a member opening /admin. An (app)/+error.svelte helps only errors inside (app) routes; unmatched paths such as /nope still get the root page.

### Whole app

- [ ] **#170 Low** Keyboard users reach the Groceries, Menu and Recipes tabs only after every control: 152 Tab presses on Recipes
  - **Where:** `src/routes/(app)/+layout.svelte:55`, `src/routes/(app)/+layout.svelte:59`, `src/routes/(app)/+layout.svelte:62`
  - **Problem:** A keyboard user on a computer is on Recipes and wants the Menu. They have to tab through every tag chip and every recipe, or go round through the browser's address bar.
  - **Fix:** Put the tab bar's nav before <main> in the DOM; it's position: fixed, so it stays at the bottom on screen. Alternatively, add a 'Skip to navigation' link at the start of the page.
  - **Verifier's correction:** Correction: Groceries is reachable at stop 1 through the Meals brand link (href /groceries), so it is really Menu and Recipes that are far away. Screen reader users can jump to the nav landmark named 'Main', so WCAG 2.4.1 is met and uiux/low is right. This is a cheap fix for keyboard-only users on computers or tablets. One trade-off: moving the nav before main puts three extra stops ahead of each page's content for mobile screen readers swiping in order. A skip link avoids that.
- [ ] **#171 Low** At 400% zoom or in phone landscape, the sticky header and fixed tab bar leave about half the screen
  - **Where:** `src/routes/(app)/+layout.svelte:88`, `src/routes/(app)/+layout.svelte:199`, `src/lib/components/Feedback.svelte:87`
  - **Problem:** A low-vision person at 400% zoom, or someone cooking with the phone sideways, sees about four lines of the list at a time between the two bars.
  - **Fix:** On short screens, let the header scroll away, for example `@media (max-height: 30rem) { header { position: static } }`. Consider also hiding the floating feedback button there.
  - **Verifier's correction:** Correction: 'about half the screen' is true only at 400% zoom; in phone landscape the bars leave about two-thirds. Related defect the finding does not mention: tabbing through /recipes at 400% zoom left 5 of 77 focused controls (tag chips at y 212-256) completely under the tab bar (top 199), because the page did not scroll. That fails WCAG 2.2 SC 2.4.11. Partly covered stops happen at every size: 12 of 77 on desktop, 20 on Pixel 7 portrait, 41 in landscape (obscured.cjs). Injecting html { scroll-padding: 57px 0 calc(57px + 3.75rem) } in the browser only (obscured-pad.cjs) brought this to 0 at all four sizes.
- [ ] **#172 Low** On a computer the week is one narrow column, and a drag can't reach days below the fold without the wheel
  - **Where:** `src/routes/(app)/menu/+page.svelte:542`, `src/routes/(app)/menu/+page.svelte:228`
  - **Problem:** Dragging Sunday's dinner onto Friday on a laptop: the target is off screen and the page doesn't scroll toward it.
  - **Fix:** On wide screens lay the days out in a grid (two to four columns, or seven), and auto-scroll while the pointer is near the window's top or bottom during a drag.
  - **Notes:** Likely, not fully proven
- [ ] **#173 Low** Dragging a day can't reach a day below the window without the mouse wheel; nothing scrolls at the edge
  - **Where:** `src/routes/(app)/menu/+page.svelte:228`
  - **Problem:** On a laptop trackpad someone drags Sunday's dinner toward Saturday. The page doesn't scroll at the bottom, and holding a click while two-finger scrolling is awkward, so they give up.
  - **Fix:** While dragging, scroll the window when the pointer is within about 60 px of the top or bottom (a requestAnimationFrame loop started from movePointer), updating dropTarget as it scrolls.
  - **Verifier's correction:** Correction: no day is outlined at the bottom edge because the fixed tab bar covers it (elementFromPoint at y 760 to 797 returns a tab link), so the scroll zone should start above the tab bar. The mouse wheel still works during a drag, and Move to another date is the alternative, so low.
- [ ] **#174 Low** Give Meals a home-screen icon and web app manifest for phones
  - **Where:** `src/app.html:9`, `static/favicon.svg`
  - **Problem:** A parent adds Meals to their iPhone's home screen to reach the list quickly in the store. iOS can't use an SVG favicon, so the icon is a shrunken screenshot of the page, and Meals opens in an ordinary browser tab with its toolbars.
  - **Fix:** Add a 180 px apple-touch-icon.png and a small manifest (name, short_name, theme and background colors from app.css, 192 and 512 px icons made from favicon.svg, display: standalone), linked from app.html. This adds no offline support (Q10).
  - **Verifier's correction:** Correction to the scenario: since iOS 26, a site added to the iPhone Home Screen opens as a web app by default (the Open as Web App toggle is on). So 'opens in an ordinary browser tab' now applies mainly to Android Chrome: without a manifest, Add to Home screen makes a plain shortcut that opens in a Chrome tab, and Chrome offers no Install app. The icon problem stands on both phones. iOS takes the home-screen icon from apple-touch-icon or the manifest icons, and Meals has neither, so iOS shows a stand-in (a page screenshot or a generated tile) instead of the tomato.

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
