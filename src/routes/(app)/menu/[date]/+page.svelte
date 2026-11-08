<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { deserialize, type SubmitFunction } from '$app/forms';
	import { goto } from '$app/navigation';
	import AddDinner from '#lib/components/AddDinner.svelte';
	import DayRequests from '#lib/components/DayRequests.svelte';
	import DinnerEditor, { type Editing, type Typing } from '#lib/components/DinnerEditor.svelte';
	import MoveDinner from '#lib/components/MoveDinner.svelte';
	import Snapshot from '#lib/components/Snapshot.svelte';
	import { formatDateLabel } from '#lib/dates.ts';
	import { MAX_DINNERS, hasDishes, weekStart } from '#lib/menu.ts';
	import { normalizeName } from '#lib/text.ts';

	// A date's dinners (design 7, Dinner; 6.9), each with its own editor, in the order they were
	// added. Move takes them all to another date, and Add a dinner adds another, up to 5. Under
	// them, the Menu's requests, whose dishes can go on a dinner and whose restaurants can become
	// one (6.12).
	let { data, form } = $props();

	type Dinner = (typeof data.dinners)[number];

	const dinners = $derived(data.dinners);
	const labeled = $derived(dinners.length > 1);
	const dateLabel = $derived(formatDateLabel(data.date, { today: data.today, weekday: 'long' }));
	let mover = $state<ReturnType<typeof MoveDinner>>();
	let title = $state<HTMLElement>();

	// What a reload took off the page: a failure whose part of the page went with the reload
	// after it, such as adding a dish just as someone switched the dinner to Eating out, or what
	// happened to something typed when someone else changed the dinner. It shows here, for this
	// date, until the next change.
	let notice = $state<{ date: string; messages: string[] } | null>(null);
	let noticeElement = $state<HTMLElement>();
	const problems = $derived(
		notice?.date === data.date
			? notice.messages
			: form && 'error' in form && form.error
				? [form.error]
				: []
	);

	async function showNotice(message: string) {
		const shown = notice?.date === data.date ? notice.messages : [];
		if (!shown.includes(message)) notice = { date: data.date, messages: [...shown, message] };
		await focusNotice();
	}

	async function focusNotice() {
		await tick();
		noticeElement?.focus();
	}

	function dropNotice(message: string) {
		if (!notice?.messages.includes(message)) return;
		const messages = notice.messages.filter((shown) => shown !== message);
		notice = messages.length > 0 ? { ...notice, messages } : null;
	}

	/** Whether a dinner has the dish section: no dinner yet, or one of a type with dishes. */
	function withDishes(shown: Dinner | null): boolean {
		return shown === null || hasDishes(shown.type);
	}

	// What the details form shows on a date with no dinner: Cooking at home at the usual servings,
	// saved only by Save, a dish, a copy or a type (6.9, Q28).
	function unplannedDinner(): Editing {
		return {
			id: null,
			label: null,
			type: 'cook',
			restaurantName: null,
			note: null,
			servings: data.defaultServings
		};
	}

	// One editor per dinner, or one for a date with no dinner. Each keeps its key while it's for
	// the same dinner, so what's typed in it stays. `dinner` is the dinner as it is now (null on a
	// date with none), and `editing` what the details form is for. When a reload finds a dinner
	// someone cleared while something typed in its form isn't saved, and the date has no dinner
	// left, the form keeps that dinner, since such a reload, as on coming back to the app (Q11),
	// would otherwise drop what was typed without a word, and saving plans the date again with it
	// (6.11, MEA-256).
	type Slot = { key: number; dinner: Dinner | null; editing: Editing };
	let nextKey = 0;
	function slotFor(dinner: Dinner | null, key = nextKey++): Slot {
		return { key, dinner, editing: dinner ?? unplannedDinner() };
	}
	function freshSlots(now: Dinner[]): Slot[] {
		return now.length > 0 ? now.map((dinner) => slotFor(dinner)) : [slotFor(null)];
	}
	/** A form that keeps a dinner gone from the date, for Save to plan the date again with it. */
	function heldSlot(editing: Editing, key = nextKey++): Slot {
		return { key, dinner: null, editing };
	}
	let slots = $state.raw<Slot[]>(untrack(() => freshSlots(data.dinners)));
	const editors: Record<number, ReturnType<typeof DinnerEditor> | null> = $state({});
	const CLEARED = 'Someone cleared this dinner. Save to plan it again with what you typed.';
	// When the page couldn't find out whether it was cleared or moved.
	const CLEARED_OR_MOVED =
		'Someone cleared or moved this dinner. Save to plan it again with what you typed.';

	// How many of this page's own changes are on their way, each from when it's sent until the
	// reload after it settles, or the page it goes to opens. Any reload meanwhile can show what
	// they did, so it's the person's own: what it takes off the page goes without a word, and
	// what's typed in the forms stays for Save, also when a change planned the date. A change that
	// didn't go through changed nothing, so it stops counting when its answer comes, and the
	// reload after it shows what someone else did (MEA-128).
	let ownChanges = 0;

	// The form whose change is planning the date, sent while it had no dinner. Until the reload
	// after it, the page's other forms still show the date as not planned, so what's sent from
	// them meanwhile would go to no dinner and be refused. It waits instead, and is sent again
	// once the page shows the dinner just planned: the latest from each form, in the order they
	// were first sent (MEA-128).
	let planning: HTMLFormElement | null = null;
	const waiting = new Map<HTMLFormElement, HTMLElement | null>();

	/**
	 * Sends one of the page's own changes, counted while it's on its way, or holds it while
	 * another form's change is planning the date.
	 */
	function send(submit: SubmitFunction): SubmitFunction {
		return async (input) => {
			if (planning !== null && input.formElement !== planning) {
				waiting.set(input.formElement, input.submitter);
				return input.cancel();
			}
			const plans = planning === null && dinners.length === 0;
			if (plans) planning = input.formElement;
			ownChanges += 1;
			let cancelled = false;
			const callback = await submit({
				...input,
				cancel: () => {
					cancelled = true;
					input.cancel();
				}
			});
			if (cancelled) {
				ownChanges -= 1;
				if (plans) await endPlanning(true);
				return;
			}
			return async (options) => {
				// Moving and saving go to another page, so they count until it opens. The page this
				// one keeps for Back then knows the move was the person's own (MEA-256).
				const went = options.result.type === 'success' || options.result.type === 'redirect';
				if (!went) ownChanges -= 1;
				try {
					await (callback ? callback(options) : options.update());
				} finally {
					if (went) ownChanges -= 1;
					if (plans) await endPlanning(options.result.type === 'success');
				}
			};
		};
	}

	/**
	 * Once the change planning the date is done, sends again what waited for it, each made as the
	 * person made it, so a switch or a copy that would now take dishes off asks first. When that
	 * change didn't go through, nothing that waited is sent: the page says why, and the person
	 * can make them again.
	 */
	async function endPlanning(sendAgain: boolean): Promise<void> {
		planning = null;
		const waited = [...waiting];
		waiting.clear();
		if (!sendAgain) return;
		// Once the forms show the dinner just planned.
		await tick();
		for (const [form, submitter] of waited) {
			if (submitter) submitter.click();
			else form.requestSubmit();
		}
	}

	// What's typed in a dinner's forms and not saved, under the dinner they're for (MEA-202,
	// MEA-240, MEA-256).
	type Draft = Typing & { dinner: Editing };

	/** What's typed in a slot's forms and not saved, or null. */
	function draftOf(slot: Slot): Draft | null {
		const typing = editors[slot.key]?.typing();
		if (!typing) return null;
		const { id, label, type, restaurantName, note, servings } = slot.editing;
		return { ...typing, dinner: { id, label, type, restaurantName, note, servings } };
	}

	/**
	 * What the notice says when what was typed for a dinner can't stay in its form, with the note
	 * as it would be saved, to copy, and any dish name.
	 */
	function lostMessage(what: string, { fields, dishName }: Typing): string {
		const note = fields.note?.replace(/\r\n?/g, '\n').trim() ?? '';
		const lost: string[] = [];
		if (note !== '') lost.push(`your note wasn't saved: "${note}"`);
		else if (Object.keys(fields).length > 0) lost.push("your changes weren't saved");
		if (dishName !== null) lost.push(`${normalizeName(dishName)} wasn't added`);
		const message = `${what}, so ${lost.join(', and ')}`;
		return note !== '' && dishName === null ? message : `${message}.`;
	}

	/** Says what was typed in an editor's details, to copy, when another dinner takes its place. */
	function lostTyped(editor: ReturnType<typeof DinnerEditor>, what: string): void {
		const typing = editor.typing();
		if (typing) void showNotice(lostMessage(what, { fields: typing.fields, dishName: null }));
	}

	// Typing for dinners someone else took off the date (MEA-256). While the page finds out where
	// each went, it stays in the form that keeps it while the date has no dinner (held for Save,
	// or a dish name alone in the date's empty form), or is kept here. Typing for a dinner someone
	// moved then waits under its new date, until Open takes it there.
	type Lost = { id: number; draft: Draft; key: number | null };
	type Moved = { date: string; drafts: Draft[] };
	let finding: Draft[] = [];
	let moved = $state.raw<Moved[]>([]);
	let carried: Moved | null = null;

	/** Where each of these dinners is now, by id, or null when the page couldn't find out. */
	async function whereNow(date: string, ids: number[]): Promise<Map<number, string> | null> {
		try {
			const response = await fetch(`/menu/${date}?/find`, {
				method: 'POST',
				headers: { accept: 'application/json', 'x-sveltekit-action': 'true' },
				body: new URLSearchParams({ dinnerIds: ids.join(',') })
			});
			const result = deserialize(await response.text());
			if (result.type !== 'success') return null;
			const { found } = result.data as { found: { id: number; date: string }[] };
			return new Map(found.map((dinner) => [dinner.id, dinner.date]));
		} catch {
			// No connection, or no answer the page could read.
			return null;
		}
	}

	/**
	 * Finds out where dinners gone from the date went, and keeps what was typed for each. For a
	 * dinner someone moved, it waits under the new date for Open. For one someone cleared, a held
	 * form stays for Save while the date has no dinner, with a dish name alone in the date's empty
	 * form for Add (MEA-127), and otherwise the notice says what was typed.
	 */
	async function find(lost: Lost[]): Promise<void> {
		const date = data.date;
		const waited = lost.filter((entry) => entry.key === null).map((entry) => entry.draft);
		finding = [...finding, ...waited];
		const found = await whereNow(date, lost.map((entry) => entry.id));
		finding = finding.filter((draft) => !waited.includes(draft));
		// Another date's page now: this date's snapshot kept what was typed.
		if (data.date !== date) return;
		for (const { id, draft, key } of lost) {
			const slot = key === null ? null : keeping(key, id);
			// Its form went meanwhile, as when Save planned the date again.
			if (slot === undefined) continue;
			const to = found?.get(id);
			if (to !== undefined) waitFor(to, slot ? takeFrom(slot, draft.dinner) : draft);
			else if (slot) {
				if (slot.editing.id === id) void showNotice(found ? CLEARED : CLEARED_OR_MOVED);
			} else if (!found || !keepCleared(draft)) {
				const what = found ? 'Someone cleared this dinner' : 'Someone cleared or moved this dinner';
				void showNotice(lostMessage(what, draft));
			}
		}
	}

	/**
	 * The form with this key while it still keeps what was typed for the dinner: held for it, or
	 * the date's empty form with a dish name typed alone. Not one that shows another dinner now.
	 */
	function keeping(key: number, dinnerId: number): Slot | undefined {
		return slots.find(
			(slot) => slot.key === key && (slot.editing.id === dinnerId || slot.editing.id === null)
		);
	}

	/**
	 * Keeps what was typed for a dinner someone cleared in a form on the date while it has no
	 * dinner and nothing is typed in its empty form: held for Save, or a dish name alone in the
	 * empty form for Add (MEA-127). False when it can't.
	 */
	function keepCleared(draft: Draft): boolean {
		const empty = slots.find((slot) => slot.editing.id === null);
		if (dinners.length > 0 || (empty && editors[empty.key]?.typing())) return false;
		if (Object.keys(draft.fields).length === 0) {
			if (!empty) return false;
			editors[empty.key]?.restore(draft);
			return true;
		}
		const held = heldSlot(draft.dinner);
		slots = [...slots.filter((slot) => slot !== empty), held];
		// Once its editor is on the page.
		void tick().then(() => editors[held.key]?.restore(draft));
		void showNotice(CLEARED);
		return true;
	}

	/**
	 * Takes what was typed for a dinner someone moved out of the form that kept it: a form held
	 * for it goes, and the date's empty form keeps all but the dish name.
	 */
	function takeFrom(slot: Slot, dinner: Editing): Draft | null {
		const typing = editors[slot.key]?.typing() ?? null;
		if (slot.editing.id === dinner.id) {
			const rest = slots.filter((other) => other !== slot);
			slots = rest.length > 0 ? rest : [slotFor(null)];
			return typing && { ...typing, dinner };
		}
		editors[slot.key]?.dropName();
		return typing?.dishName ? { dinner, fields: {}, dishName: typing.dishName } : null;
	}

	/** Keeps what was typed for a dinner someone moved, until Open takes it to the new date. */
	function waitFor(date: string, draft: Draft | null): void {
		if (draft === null) return;
		const group = moved.find((candidate) => candidate.date === date);
		moved = group
			? moved.map((other) => (other === group ? { date, drafts: [...group.drafts, draft] } : other))
			: [...moved, { date, drafts: [draft] }];
		void focusNotice();
	}

	/** Opens the date a dinner was moved to, with what was typed for it (MEA-256). */
	function openMoved(group: Moved): void {
		if (!canLeave()) return;
		moved = moved.filter((other) => other !== group);
		carried = group;
		void goto(`/menu/${group.date}`);
	}

	// When a phone drops the app in the background to free memory, coming back loads the page
	// again, which would lose what was typed without a word. The tab keeps what's typed and not
	// saved in each dinner's forms, under the dinner they're for, and gets it back when the page
	// loads again (design 7, Dinner; MEA-202) or Back or Forward returns to it (MEA-240), also for
	// a dinner someone cleared or moved meanwhile (MEA-256). It keeps whether the page's own
	// changes were on their way too, since what they took off the page is the person's own.
	type Kept = { drafts: Draft[]; own: boolean };

	function capture(): Kept {
		const typed = slots.map(draftOf).filter((draft) => draft !== null);
		const waited = moved.flatMap((group) => group.drafts);
		return { drafts: [...typed, ...finding, ...waited], own: ownChanges > 0 };
	}

	/**
	 * Puts back what was typed for each dinner still on the date, and keeps the rest while the
	 * page finds out where those dinners went. What the page's own change took off the page goes
	 * without a word, and what was typed on a date with no dinner goes to the dinner it planned.
	 */
	function restore({ drafts, own }: Kept): void {
		const lost: Lost[] = [];
		const unclaimed = slots.filter(
			(slot) => !drafts.some((draft) => draft.dinner.id === slot.editing.id)
		);
		for (const draft of drafts) {
			const { id } = draft.dinner;
			const slot =
				slots.find((candidate) => candidate.editing.id === id) ??
				(own && id === null ? unclaimed.shift() : undefined);
			if (slot) {
				// A dish name for a dinner someone switched to a type without dishes.
				const message = editors[slot.key]?.restore(draft);
				if (message && !own) void showNotice(message);
			} else if (own) {
				// The page's own change took it off the page.
			} else if (id === null) {
				void showNotice(lostMessage('Someone put another dinner on this date', draft));
			} else {
				lost.push({ id, draft, key: null });
			}
		}
		if (lost.length > 0) void find(lost);
	}

	/**
	 * The editors for the date's dinners as they are now. An editor stays with its dinner, and a
	 * dinner new to the page takes over an editor whose dinner is gone, as when someone moved
	 * another dinner onto the date or the page's own change planned it. What was typed for a dinner
	 * someone else cleared or moved never shows in another dinner's form: the page finds out where
	 * that dinner went and keeps it (MEA-256).
	 */
	function reconcile(now: Dinner[], own: boolean): void {
		const targets: (Dinner | null)[] = now.length > 0 ? now : [null];
		const isFor = (slot: Slot, target: Dinner | null) => slot.editing.id === (target?.id ?? null);
		const gone = slots.filter((slot) => !targets.some((target) => isFor(slot, target)));
		const next: Slot[] = [];
		const lost: Lost[] = [];
		// What was typed for a slot's dinner when it just went, someone else's doing, kept in the
		// form with this key while the page finds out where it went, or none.
		const lostFrom = (slot: Slot, key: number | null): Lost | null => {
			const draft = !own && slot.dinner ? draftOf(slot) : null;
			return slot.dinner && draft ? { id: slot.dinner.id, draft, key } : null;
		};
		let held = false;
		for (const target of targets) {
			const same = slots.find((slot) => isFor(slot, target));
			if (target === null && !same && !own) {
				const unsaved = gone.filter((slot) => editors[slot.key]?.hasUnsaved());
				if (unsaved.length > 0) {
					for (const slot of unsaved) {
						gone.splice(gone.indexOf(slot), 1);
						next.push(heldSlot(slot.editing, slot.key));
						// Found out once, when the dinner goes; later reloads find it still gone.
						const entry = lostFrom(slot, slot.key);
						if (entry) lost.push(entry);
					}
					held = true;
					continue;
				}
			}
			const slot = same ?? gone.shift();
			if (!slot) {
				next.push(slotFor(target));
				continue;
			}
			const editor = editors[slot.key];
			const entry = same ? null : lostFrom(slot, target === null ? slot.key : null);
			if (!own && !same && target !== null && editor?.hasUnsaved() && editor.matches(target)) {
				// A dinner that already has what was typed is this page's own save planning the
				// date again.
			} else if (entry) {
				// Someone cleared or moved its dinner. A dish name alone stays in the date's empty
				// form while the page finds out where the dinner went. Another dinner's form shows
				// that dinner, so its note isn't replaced unseen.
				lost.push(entry);
				if (target !== null) {
					void tick().then(() => {
						editor?.reset();
						editor?.dropName();
					});
				}
			} else if (!own && !same && target !== null && editor?.hasUnsaved()) {
				// Someone put a dinner on the date while something typed in its empty form, or in a
				// form held for a cleared dinner, isn't saved. The form shows that dinner, so its
				// note isn't replaced unseen, and what was typed goes in the notice to copy.
				lostTyped(editor, 'Someone put another dinner on this date');
				void tick().then(() => editor.reset());
			} else if (!own && withDishes(slot.dinner) && !withDishes(target)) {
				// Someone switched it to a type without dishes, which takes the dish field away.
				const name = editor?.nameLost();
				if (name) void showNotice(name);
			}
			next.push(slotFor(target, slot.key));
		}
		// Editors left over: someone cleared or moved their dinners while others are on the date.
		for (const slot of gone) {
			const editor = editors[slot.key];
			const entry = lostFrom(slot, null);
			if (entry) lost.push(entry);
			else if (!own && editor?.hasUnsaved()) {
				lostTyped(editor, 'Someone put another dinner on this date');
			}
		}
		// The form held for a cleared dinner has nothing left to save, so its notice goes too.
		if (!held) {
			dropNotice(CLEARED);
			dropNotice(CLEARED_OR_MOVED);
		}
		slots = next;
		if (lost.length > 0) void find(lost);
	}

	// After each load and before the page updates, while the editors about to go still hold what
	// was typed in them.
	let loadedDate = untrack(() => data.date);
	$effect.pre(() => {
		const now = { date: data.date, dinners: data.dinners };
		untrack(() => {
			if (now.date !== loadedDate) {
				loadedDate = now.date;
				slots = freshSlots(now.dinners);
				finding = [];
				moved = [];
				// What was typed for a dinner someone moved here, which Open brought.
				const brought = carried?.date === now.date ? carried.drafts : [];
				carried = null;
				if (brought.length > 0) void tick().then(() => restore({ drafts: brought, own: false }));
				return;
			}
			reconcile(now.dinners, ownChanges > 0);
		});
	});

	/** "Oct 4": the Sunday that starts the week (Q27b). */
	function weekLabel(date: string): string {
		return new Intl.DateTimeFormat('en-US', {
			timeZone: 'UTC',
			month: 'short',
			day: 'numeric'
		}).format(new Date(`${weekStart(date)}T00:00:00Z`));
	}

	// Clearing removes the actions it was among, so focus goes to the date's new state.
	let unplanned = $state<HTMLElement>();
	function cleared() {
		(unplanned ?? title)?.focus();
	}

	/** The new dinner is the last one, since they're in the order they were added. */
	async function added() {
		await tick();
		const last = slots.at(-1);
		if (last) editors[last.key]?.focus();
	}

	/**
	 * A request's note went on the end of the dinner's saved note, so a note typed there and not
	 * saved gets it too, and Save keeps it (6.12).
	 */
	function requestAdded(dinnerId: number, note: string | null): void {
		if (note === null) return;
		const slot = slots.find((candidate) => candidate.dinner?.id === dinnerId);
		if (slot) editors[slot.key]?.addNote(note);
	}

	/** Moving opens the new date, so it asks about anything typed in any of the dinners. */
	function canLeave(): boolean {
		return slots.every((slot) => editors[slot.key]?.confirmLeave() ?? true);
	}

	function keepAsking(): void {
		for (const slot of slots) editors[slot.key]?.keepAsking();
	}
</script>

<svelte:head>
	<title>{formatDateLabel(data.date, { today: data.today })} · Meals</title>
</svelte:head>

<!-- Any form sent, as the person goes on, takes the last failure's messages away. -->
<svelte:document onsubmit={() => (notice = null)} />

<!-- What's typed in each dinner's forms, kept for when the page loads again (MEA-202, MEA-256). -->
<Snapshot id="dinners" {capture} {restore} />

<!-- Rebuilt for each date, so nothing typed for one date shows up on another. -->
{#key data.date}
	<a class="link-tap week" href="/menu?week={weekStart(data.date)}">‹ Week of {weekLabel(data.date)}</a>

	<!-- A planned date opens Move to another date (2.2.2, 7). -->
	<div class="title">
		<h1 tabindex="-1" bind:this={title}>
			{#if dinners.length > 0}
				<button
					type="button"
					class="quiet date"
					aria-label="{dateLabel}. Move to another date"
					onclick={() => mover?.show()}
				>
					<!-- No space before the icon, so the heading's text is the date alone. -->
					{dateLabel}<svg viewBox="0 0 24 24" aria-hidden="true"
						><rect x="3" y="5" width="18" height="16" rx="2" /><path
							d="M3 10h18M8 3v4M16 3v4"
						/></svg
					>
				</button>
			{:else}
				{dateLabel}
			{/if}
		</h1>
		{#if data.date === data.today}<span class="badge today">Today</span>{/if}
	</div>

	{#if problems.length > 0 || moved.length > 0}
		<div class="error notice" role="alert" tabindex="-1" bind:this={noticeElement}>
			{#each problems as message (message)}
				<p>{message}</p>
			{/each}
			<!-- What was typed for a dinner someone moved goes with Open, until then (MEA-256). -->
			{#each moved as group (group.date)}
				{@const to = formatDateLabel(group.date, { today: data.today })}
				{@const several = group.drafts.length > 1}
				<p>
					Someone moved {several ? 'these dinners' : 'this dinner'} to {to}. What you typed goes
					with {several ? 'them' : 'it'}.
				</p>
				<button type="button" onclick={() => openMoved(group)}>Open {to}</button>
			{/each}
		</div>
	{/if}

	{#if dinners.length === 0}
		<p class="muted unplanned" tabindex="-1" bind:this={unplanned}>Not planned yet.</p>
	{/if}

	{#each slots as slot (slot.key)}
		<DinnerEditor
			dinner={slot.dinner}
			editing={slot.editing}
			{labeled}
			suggestions={data.dishes}
			copyGroups={data.copyGroups}
			today={data.today}
			onlost={showNotice}
			{send}
			oncleared={cleared}
			bind:this={editors[slot.key]}
		/>
	{/each}

	{#if dinners.length > 0 && dinners.length < MAX_DINNERS}
		<div class="add">
			<AddDinner count={dinners.length} {send} onadded={added} />
		</div>
	{/if}

	<DayRequests
		requests={data.requests}
		{dinners}
		dishes={data.dishes}
		{send}
		onadded={requestAdded}
	/>

	{#if dinners[0]}
		<MoveDinner
			date={data.date}
			today={data.today}
			count={dinners.length}
			dinnerId={dinners[0].id}
			{canLeave}
			{keepAsking}
			onlost={showNotice}
			{send}
			bind:this={mover}
		/>
	{/if}
{/key}

<style>
	.week {
		font-weight: 700;
	}

	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.title h1 {
		margin: 0;
	}

	/* Looks like the heading it's in, with the icon saying it can be tapped. */
	.title .date {
		font-weight: inherit;
		color: inherit;
		padding-inline: 0;
		text-align: start;
	}

	.date svg {
		flex: none;
		width: 1.1em;
		height: 1.1em;
		fill: none;
		stroke: var(--accent);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.today {
		color: var(--accent);
	}

	/* It can name a dish, and a long name without spaces still wraps. */
	.notice {
		display: grid;
		justify-items: start;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		overflow-wrap: anywhere;
	}

	.notice p {
		margin: 0;
	}

	.unplanned {
		margin-bottom: 0.5rem;
	}

	.add {
		display: grid;
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
</style>
