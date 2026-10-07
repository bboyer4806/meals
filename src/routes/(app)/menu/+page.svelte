<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { rangeLabel } from '#lib/checklist.ts';
	import Sheet from '#lib/components/Sheet.svelte';
	import { formatDateLabel } from '#lib/dates.ts';
	import {
		DEFAULT_CHECK_DAYS,
		DINNER_TYPE_LABELS,
		DISH_ROLE_LABELS,
		MAX_CHECK_DAYS,
		addDays,
		daysBetween,
		hasDishes,
		isDate
	} from '#lib/menu.ts';

	let { data } = $props();

	// Check pantry (6.8): a range of dates, posted to the pantry page, which opens the new check.

	let checkOpen = $state(false);
	let checkStart = $state('');
	let checkEnd = $state('');
	let starting = $state(false);

	/** Opens with the next 7 days every time, so dates abandoned last time don't come back. */
	function openCheck() {
		checkStart = data.check.startDate;
		checkEnd = data.check.endDate;
		checkOpen = true;
	}

	const checkDays = $derived(
		isDate(checkStart) && isDate(checkEnd) ? daysBetween(checkStart, checkEnd) + 1 : null
	);
	const rangeOk = $derived(checkDays !== null && checkDays >= 1 && checkDays <= MAX_CHECK_DAYS);

	/** A new start that leaves the end before it, or too far after it, moves the end too. */
	function startChanged() {
		if (isDate(checkStart) && !rangeOk) checkEnd = addDays(checkStart, DEFAULT_CHECK_DAYS - 1);
	}

	// The end field's `min` keeps it on or after the start. A `max` as well would make Chrome dim
	// the parts of the date it can't change, so the limit on days is checked here instead, and
	// the browser stops the form with this message.
	let endInput = $state<HTMLInputElement>();
	$effect(() => {
		const tooLong = checkDays !== null && checkDays > MAX_CHECK_DAYS;
		endInput?.setCustomValidity(tooLong ? `Pick ${MAX_CHECK_DAYS} days or fewer` : '');
	});

	const replaceQuestion = $derived(
		`This replaces the current pantry check, which has ${data.pantryMarked} ` +
			`${data.pantryMarked === 1 ? 'item' : 'items'} checked.`
	);

	// The pantry page's action redirects there, or, when someone checked items on the current
	// check since this page loaded, fails there with a message; either way SvelteKit goes to it.
	const submitCheck: SubmitFunction = ({ cancel }) => {
		if (starting) return cancel();
		starting = true;
		return async ({ update }) => {
			try {
				await update();
			} finally {
				starting = false;
			}
		};
	};
</script>

<svelte:head>
	<title>Menu · Meals</title>
</svelte:head>

<div class="title row">
	<h1 class="grow">Menu</h1>
	<button type="button" onclick={openCheck}>Check pantry</button>
</div>

<nav class="weeks" aria-label="Weeks">
	<p class="label" aria-live="polite">{data.label}</p>
	<div class="week-buttons">
		<a class="button" href="/menu?week={data.previous}">
			<span aria-hidden="true">‹</span> Previous
		</a>
		<a class="button" href="/menu" aria-current={data.isThisWeek ? 'page' : undefined}>This week</a>
		<a class="button" href="/menu?week={data.next}">Next <span aria-hidden="true">›</span></a>
	</div>
</nav>

<ol class="days">
	{#each data.days as day (day.date)}
		{@const isToday = day.date === data.today}
		{@const { dinner } = day}
		<li>
			<a
				class="day card"
				class:today={isToday}
				href="/menu/{day.date}"
				aria-current={isToday ? 'date' : undefined}
			>
				<span class="when">
					<span class="date">{formatDateLabel(day.date)}</span>
					{#if isToday}<span class="today-badge">Today</span>{/if}
				</span>
				{#if dinner}
					<span class="type">{DINNER_TYPE_LABELS[dinner.type]}</span>
					{#each dinner.roles as group (group.role)}
						<span class="dishes">
							<span class="role">{DISH_ROLE_LABELS[group.role]}</span>
							<span class="names">{group.names.join(', ')}</span>
						</span>
					{:else}
						{#if hasDishes(dinner.type)}<span class="muted">No dishes yet</span>{/if}
					{/each}
					{#if dinner.note}<span class="note">{dinner.note}</span>{/if}
				{:else}
					<span class="muted">Not planned</span>
				{/if}
			</a>
		</li>
	{/each}
</ol>

<Sheet bind:open={checkOpen} title="Check pantry">
	<form method="POST" action="/pantry?/startMenu" use:enhance={submitCheck}>
		<div class="dates">
			<div class="field">
				<label for="check-start">From</label>
				<input
					id="check-start"
					name="startDate"
					type="date"
					required
					bind:value={checkStart}
					onchange={startChanged}
				/>
			</div>
			<div class="field">
				<label for="check-end">To</label>
				<input
					id="check-end"
					name="endDate"
					type="date"
					required
					min={isDate(checkStart) ? checkStart : undefined}
					bind:value={checkEnd}
					bind:this={endInput}
				/>
			</div>
		</div>
		<p class="muted" aria-live="polite">
			{#if rangeOk && checkDays !== null}
				{rangeLabel(checkStart, checkEnd)}, {checkDays === 1 ? '1 day' : `${checkDays} days`}
			{:else}
				Pick up to {MAX_CHECK_DAYS} days, ending on or after the start.
			{/if}
		</p>
		{#if data.pantryMarked > 0}
			<!-- Sent only from this sheet, which says what it replaces before the button. -->
			<input type="hidden" name="replaceChecked" value="1" />
			<p>{replaceQuestion}</p>
		{/if}
		<div class="row">
			<button class="primary" disabled={starting}>
				{data.pantryMarked > 0 ? 'Start new check' : 'Start check'}
			</button>
			<button type="button" onclick={() => (checkOpen = false)}>Cancel</button>
		</div>
	</form>
</Sheet>

<style>
	.title {
		margin-bottom: 0.25rem;
	}

	.title h1 {
		margin: 0;
	}

	.weeks {
		margin-bottom: 0.75rem;
	}

	.label {
		margin: 0 0 0.5rem;
		font-weight: 700;
	}

	/* Three even buttons that fit a phone. */
	.week-buttons {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}

	.week-buttons .button {
		padding-inline: 0.5rem;
		white-space: nowrap;
	}

	.week-buttons [aria-current='page'] {
		background: var(--surface-sunk);
		border-color: var(--muted);
	}

	.days {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.day {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-height: var(--tap);
		margin: 0;
		/* Room on the right for the arrow. */
		padding: 0.6rem 2rem 0.7rem 1rem;
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.day::after {
		content: '›';
		position: absolute;
		right: 0.85rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: 1.4rem;
		color: var(--muted);
	}

	/* A thicker accent border and a label, so today doesn't rely on color alone. */
	.day.today {
		border: 2px solid var(--accent);
		padding: calc(0.6rem - 1px) calc(2rem - 1px) calc(0.7rem - 1px) calc(1rem - 1px);
	}

	.when {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.date {
		font-family: var(--font-heading);
		font-size: 1.15rem;
		font-weight: 600;
	}

	.today-badge {
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--on-accent);
		background: var(--accent);
		border-radius: 999px;
		padding: 0 0.5rem;
	}

	.type {
		font-weight: 700;
	}

	.dishes {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.role {
		flex: none;
		width: 5rem;
		white-space: nowrap;
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}

	.names {
		min-width: 0;
	}

	/* A long note shows its start; the dinner page has all of it. */
	.note {
		color: var(--muted);
		white-space: pre-line;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
	}

	.dates {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
	}

	.dates .field {
		margin-bottom: 0.5rem;
	}
</style>
