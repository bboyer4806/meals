<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { SubmitFunction } from '$app/forms';
	import AddDinner from '#lib/components/AddDinner.svelte';
	import DayRequests from '#lib/components/DayRequests.svelte';
	import DinnerEditor from '#lib/components/DinnerEditor.svelte';
	import MoveDinner from '#lib/components/MoveDinner.svelte';
	import { formatDateLabel } from '#lib/dates.ts';
	import { MAX_DINNERS, hasDishes, weekStart } from '#lib/menu.ts';

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
	let notice = $state<{ date: string; message: string } | null>(null);
	let noticeElement = $state<HTMLElement>();
	const problem = $derived(
		notice?.date === data.date
			? notice.message
			: form && 'error' in form && form.error
				? form.error
				: null
	);

	async function showNotice(message: string) {
		notice = { date: data.date, message };
		await tick();
		noticeElement?.focus();
	}

	/** Whether a dinner has the dish section: no dinner yet, or one of a type with dishes. */
	function withDishes(shown: Dinner | null): boolean {
		return shown === null || hasDishes(shown.type);
	}

	// What the details form shows on a date with no dinner: Cooking at home at the usual servings,
	// saved only by Save, a dish, a copy or a type (6.9, Q28).
	function unplannedDinner() {
		return {
			id: null,
			label: null,
			type: 'cook' as const,
			restaurantName: null,
			note: null,
			servings: data.defaultServings
		};
	}

	// One editor per dinner, or one for a date with no dinner. Each keeps its key while it's for
	// the same dinner, so what's typed in it stays. `dinner` is the dinner as it is now (null on a
	// date with none), and `editing` what the details form is for. When a reload finds a dinner
	// cleared or moved away while something typed in its form isn't saved, and the date has no
	// dinner left, the form keeps that dinner, since such a reload, as on coming back to the app
	// (Q11), would otherwise drop what was typed without a word, and saving plans the date again
	// with it (6.11).
	type Slot = {
		key: number;
		dinner: Dinner | null;
		editing: Dinner | ReturnType<typeof unplannedDinner>;
	};
	let nextKey = 0;
	function slotFor(dinner: Dinner | null, key = nextKey++): Slot {
		return { key, dinner, editing: dinner ?? unplannedDinner() };
	}
	function freshSlots(now: Dinner[]): Slot[] {
		return now.length > 0 ? now.map((dinner) => slotFor(dinner)) : [slotFor(null)];
	}
	let slots = $state.raw<Slot[]>(untrack(() => freshSlots(data.dinners)));
	const editors: Record<number, ReturnType<typeof DinnerEditor> | null> = $state({});
	const HELD = 'Someone cleared or moved this dinner. Save to plan it again with what you typed.';

	// How many of this page's own changes are on their way, each from when it's sent until the
	// reload after it settles. Any reload meanwhile can show what they did, so it's the person's
	// own: what it takes off the page goes without a word, and what's typed in the forms stays for
	// Save, also when a change planned the date. A change that didn't go through changed nothing,
	// so it stops counting when its answer comes, and the reload after it shows what someone else
	// did (MEA-128).
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
				const counted = options.result.type === 'success';
				if (!counted) ownChanges -= 1;
				try {
					await (callback ? callback(options) : options.update());
				} finally {
					if (counted) ownChanges -= 1;
					if (plans) await endPlanning(counted);
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

	/**
	 * The editors for the date's dinners as they are now. An editor stays with its dinner, and a
	 * dinner new to the page takes over an editor whose dinner is gone, as when someone moved
	 * another dinner onto the date or the page's own change planned it.
	 */
	function reconcile(now: Dinner[], was: Dinner[], own: boolean): void {
		const targets: (Dinner | null)[] = now.length > 0 ? now : [null];
		const isFor = (slot: Slot, target: Dinner | null) => slot.editing.id === (target?.id ?? null);
		const gone = slots.filter((slot) => !targets.some((target) => isFor(slot, target)));
		const next: Slot[] = [];
		let held = false;
		for (const target of targets) {
			const same = slots.find((slot) => isFor(slot, target));
			if (target === null && !same && !own) {
				const unsaved = gone.filter((slot) => editors[slot.key]?.hasUnsaved());
				if (unsaved.length > 0) {
					for (const slot of unsaved) {
						gone.splice(gone.indexOf(slot), 1);
						next.push({ key: slot.key, dinner: null, editing: slot.editing });
					}
					held = true;
					// Said once, when the dinner goes; later reloads find it still gone.
					if (unsaved.some((slot) => was.some((dinner) => dinner.id === slot.editing.id))) {
						void showNotice(HELD);
					}
					continue;
				}
			}
			const slot = same ?? gone.shift();
			if (!slot) {
				next.push(slotFor(target));
				continue;
			}
			const editor = editors[slot.key];
			if (!own && !same && target !== null && editor?.hasUnsaved() && !editor.matches(target)) {
				// Someone put another dinner here (a swap, or planned it again after a clear) while
				// something typed isn't saved. The form shows that dinner, so its note isn't replaced
				// unseen, and what was typed goes in the notice to copy. A dinner that already has
				// what was typed is this page's own save planning the date again.
				lostTyped(editor, 'Someone put another dinner on this date');
				void tick().then(() => editor.reset());
			} else if (!own && withDishes(slot.dinner) && !withDishes(target)) {
				// Someone switched it to a type without dishes, which takes the dish field away.
				const lost = editor?.nameLost();
				if (lost) void showNotice(lost);
			}
			next.push(slotFor(target, slot.key));
		}
		// Editors left over: someone cleared or moved their dinners while others are on the date.
		if (!own) {
			for (const slot of gone) {
				const editor = editors[slot.key];
				if (editor?.hasUnsaved()) lostTyped(editor, 'Someone cleared or moved this dinner');
			}
		}
		// The form held for a cleared dinner has nothing left to save, so its notice goes too.
		if (!held && notice?.message === HELD) notice = null;
		slots = next;
	}

	/** Says what was typed in an editor whose dinner is gone, to copy. */
	function lostTyped(editor: ReturnType<typeof DinnerEditor>, what: string): void {
		const typed = editor.typedNote();
		void showNotice(
			typed === ''
				? `${what}, so your changes weren't saved.`
				: `${what}, so your note wasn't saved: "${typed}"`
		);
	}

	// After each load and before the page updates, while the editors about to go still hold what
	// was typed in them.
	let loaded = untrack(() => ({ date: data.date, dinners: data.dinners }));
	$effect.pre(() => {
		const now = { date: data.date, dinners: data.dinners };
		untrack(() => {
			const was = loaded;
			loaded = now;
			if (now.date !== was.date) {
				slots = freshSlots(now.dinners);
				return;
			}
			reconcile(now.dinners, was.dinners, ownChanges > 0);
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

	{#if problem}
		<p class="error notice" role="alert" tabindex="-1" bind:this={noticeElement}>{problem}</p>
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
		overflow-wrap: anywhere;
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
