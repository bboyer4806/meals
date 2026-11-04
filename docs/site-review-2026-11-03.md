# Meals site review: work list

Full read-only review of `main` at `86004ad` (Meals 1.9) on 2026-11-03. Each item was found by one reviewer and confirmed by a second that tried to disprove it. It is a snapshot: line numbers drift as the code changes, so check the code before acting on an item.

125 items have become "Review:" tickets in Jira (MEA-64 to MEA-186, in Meals 1.12 or the backlog) and 1 was dropped, so they're no longer listed here. The 48 items below keep their original numbers; items marked "Skipped in triage" were looked at on 2026-11-04 and kept for later.

## How to use this list

- Item numbers are fixed. Refer to items by number (for example #77) when we discuss them.
- Tick an item (`- [x]`) when its fix is merged, or when we decide not to do it; then add "Won't do:" and the reason under it.
- **High**: wrong results, a broken flow or an outage people can hit. **Medium**: an edge-case bug, notable debt or real friction. **Low**: minor.
- **Reopens design** means doing it changes a decision in docs/design.md, so the design is updated in the same change (AGENTS.md).
- **MEA-n** means a Jira ticket already covers it or is related.
- **Likely, not fully proven** marks the few items the second reviewer couldn't fully reproduce.

## Where to start


Items that share a cause or a fix:

- No pending state on taps: #150 (with MEA-133, MEA-145)
- Error pages: #169 (with MEA-161) (with MEA-94)
- Outdated help: #154 (with MEA-166)

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
