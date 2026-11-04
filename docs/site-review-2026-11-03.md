# Meals site review: work list

Full read-only review of `main` at `86004ad` (Meals 1.9) on 2026-11-03. Each item was found by one reviewer and confirmed by a second that tried to disprove it. It is a snapshot: line numbers drift as the code changes, so check the code before acting on an item.

169 items have become "Review:" tickets in Jira (MEA-64 to MEA-229, in Meals 1.12 or the backlog), 3 are covered by other tickets (MEA-54, MEA-183, MEA-205) and 1 was dropped, so they're no longer listed here. The item below keeps its original number; it was looked at in triage on 2026-11-04 and kept for later, marked "Skipped in triage".

## How to use this list

- Item numbers are fixed. Refer to items by number (for example #77) when we discuss them.
- Tick an item (`- [x]`) when its fix is merged, or when we decide not to do it; then add "Won't do:" and the reason under it.
- **High**: wrong results, a broken flow or an outage people can hit. **Medium**: an edge-case bug, notable debt or real friction. **Low**: minor.
- **Reopens design** means doing it changes a decision in docs/design.md, so the design is updated in the same change (AGENTS.md).
- **MEA-n** means a Jira ticket already covers it or is related.
- **Likely, not fully proven** marks the few items the second reviewer couldn't fully reproduce.

## 1. Backend issues and tech debt

### Data integrity and races

- [ ] **#16 Low** A double-tapped Create household on a slow connection shows the error page 'You already belong to a household'
  - **Where:** `src/routes/setup/+page.server.ts:13`, `src/lib/server/data/households.ts:17`, `src/routes/setup/+page.svelte:35`
  - **Problem:** On a weak phone connection someone taps Create household twice, since enhance doesn't block a second submit and the button stays enabled. Both requests pass the hook before either body arrives. The data stays correct (one household), but the second result is an error that enhance renders as 'Something went wrong / You already belong to a household'. The same happens if a member's invite joins this account while the person is submitting setup.
  - **Fix:** In the setup action, catch createHousehold's 400 (the person already has a household) and redirect(303, '/') instead of letting it become an error page. Optionally disable Create household while the request is in flight.
  - **Verifier's correction:** Correction: production nginx buffers each request body before forwarding it, so 'both requests pass the hook before either body arrives' doesn't happen there. The second tap has to reach Node within the few milliseconds the first takes, which only happens if the network delivers both at once. What the person sees depends on order. SvelteKit 3 applies the error in place only while the page is still on /setup (is_current_location, client.js:3015). If the redirect has already navigated away, it navigates back to /setup with the error result. I didn't watch this in a browser, so the visible effect is unverified. The data stays correct.
  - **Notes:** Likely, not fully proven. Skipped in triage

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
