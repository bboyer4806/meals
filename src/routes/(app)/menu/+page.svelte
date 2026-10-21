<script lang="ts">
	import { tick } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { afterNavigate, goto, refreshAll } from '$app/navigation';
	import ItemInput from '#lib/components/ItemInput.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import { formatDateLabel } from '#lib/dates.ts';
	import {
		DINNER_TYPE_LABELS,
		DISH_ROLE_LABELS,
		REQUEST_NAME_MAX,
		REQUEST_NOTE_MAX,
		hasDishes
	} from '#lib/menu.ts';

	let { data } = $props();

	// Saving a dinner's servings and note comes here with ?saved=<its id> (design 7, Dinner),
	// and that dinner's line says "Saved" for 3 seconds. The address drops it straight away, so a
	// reload, or coming back with Back, doesn't say it again.
	let saved = $state<string | null>(null);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;
	afterNavigate(({ to, shallow }) => {
		// Dropping it from the address is a navigation too.
		if (shallow || !to) return;
		clearTimeout(savedTimer);
		saved = to.url.searchParams.get('saved');
		if (saved === null) return;
		savedTimer = setTimeout(() => (saved = null), 3000);
		const address = new URL(to.url);
		address.searchParams.delete('saved');
		void goto(address, { shallow: true, replace: true });
	});

	// Dish requests (6.12). The fields stop taking characters at their limit, pasted text
	// included, and say so while they're full.

	let requestOpen = $state(false);
	let requestName = $state('');
	let requestNote = $state('');
	let requestError = $state('');
	let requesting = $state(false);
	let requestsError = $state('');
	let requestButton = $state<HTMLButtonElement>();

	function failureMessage(data: unknown): string {
		const error = (data as { error?: string } | undefined)?.error;
		return error ?? 'Something went wrong. Please try again.';
	}

	function openRequest() {
		requestError = '';
		requestOpen = true;
	}

	const submitRequest: SubmitFunction = ({ cancel }) => {
		if (requesting) return cancel();
		requesting = true;
		requestError = '';
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure') {
					requestError = failureMessage(result.data);
					return;
				}
				await update({ reset: false });
				if (result.type !== 'success') return;
				requestName = '';
				requestNote = '';
				requestOpen = false;
				await tick();
				requestButton?.focus();
			} finally {
				requesting = false;
			}
		};
	};

	// Someone else may have removed it already, which is what was wanted.
	const submitRemove: SubmitFunction = () => {
		requestsError = '';
		return async ({ result, update }) => {
			if (result.type === 'error' && result.status === 404) {
				await refreshAll();
			} else if (result.type === 'failure') {
				requestsError = failureMessage(result.data);
			} else {
				await update();
			}
			await tick();
			requestButton?.focus();
		};
	};
</script>

{#snippet limitWarning(text: string, max: number)}
	<!-- Always there, so a screen reader announces the warning when it appears. -->
	<p class="limit" role="status">
		{text.length >= max ? `You've reached the ${max}-character limit.` : ''}
	</p>
{/snippet}

<svelte:head>
	<title>Menu · Meals</title>
</svelte:head>

<h1>Menu</h1>

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

<!-- A dinner's type, dishes by role, and note. -->
{#snippet details(dinner: (typeof data.days)[number]['dinners'][number])}
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
{/snippet}

<!-- Always there, so a screen reader announces "Saved" when it appears. -->
{#snippet savedStatus(shown: boolean)}
	<span class="saved" role="status">{shown ? 'Saved' : ''}</span>
{/snippet}

<ol class="days">
	{#each data.days as day (day.date)}
		{@const isToday = day.date === data.today}
		{@const { dinners } = day}
		{@const only = dinners.length === 1 ? dinners[0] : undefined}
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
					<!-- A day's only dinner is its row; with more, each dinner has its own line (6.9). -->
					{@render savedStatus(only !== undefined && saved === String(only.id))}
				</span>
				{#if only}
					{@render details(only)}
				{:else if dinners.length > 0}
					{#each dinners as dinner (dinner.id)}
						<span class="dinner">
							<span class="label">
								{dinner.label}
								{@render savedStatus(saved === String(dinner.id))}
							</span>
							{@render details(dinner)}
						</span>
					{/each}
				{:else}
					<span class="muted">Not planned</span>
				{/if}
			</a>
		</li>
	{/each}
</ol>

<section class="card requests" aria-labelledby="requests-heading">
	<h2 id="requests-heading">Requests</h2>
	{#if requestsError}<p class="error" role="alert">{requestsError}</p>{/if}
	{#if data.requests.length > 0}
		<ul class="list">
			{#each data.requests as request (request.id)}
				<li class="request">
					<div class="what">
						{#if request.dishId !== null}
							<a class="dish" href="/recipes/{request.dishId}">{request.name}</a>
						{:else}
							<span class="dish">{request.name}</span>
						{/if}
						{#if request.note}<span class="request-note">{request.note}</span>{/if}
						<span class="muted">Asked by {request.askedBy}</span>
					</div>
					<form method="POST" action="?/removeRequest" use:enhance={submitRemove}>
						<input type="hidden" name="id" value={request.id} />
						<button class="quiet" aria-label="Remove {request.name}">Remove</button>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">No requests yet.</p>
	{/if}
	<button type="button" bind:this={requestButton} onclick={openRequest}>Request a dish</button>
</section>

<Sheet bind:open={requestOpen} title="Request a dish">
	<form method="POST" action="?/request" use:enhance={submitRequest}>
		{#if requestError}<p class="error" role="alert">{requestError}</p>{/if}
		<div class="field">
			<label for="request-name">Dish</label>
			<ItemInput
				id="request-name"
				name="name"
				placeholder="Search or type a dish"
				items={data.dishes}
				bind:value={requestName}
				noun={null}
			/>
			{@render limitWarning(requestName, REQUEST_NAME_MAX)}
		</div>
		<div class="field">
			<label for="request-note">Note (optional)</label>
			<input
				id="request-note"
				name="note"
				autocomplete="off"
				maxlength={REQUEST_NOTE_MAX}
				bind:value={requestNote}
			/>
			{@render limitWarning(requestNote, REQUEST_NOTE_MAX)}
		</div>
		<button class="primary">Request</button>
	</form>
</Sheet>

<style>
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

	.saved {
		font-weight: 700;
		color: var(--received);
	}

	.type {
		font-weight: 700;
	}

	.dinner {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.dinner + .dinner {
		margin-top: 0.35rem;
		padding-top: 0.35rem;
		border-top: 1px solid var(--border);
	}

	.label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-heading);
		font-weight: 600;
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

	.requests {
		margin-top: 1rem;
		overflow-wrap: anywhere;
	}

	.requests ul {
		margin-bottom: 0.75rem;
	}

	.request {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.dish {
		font-weight: 700;
	}

	.request-note {
		white-space: pre-line;
	}

	/* Takes no room while empty. */
	.limit {
		margin: 0;
		color: var(--muted);
	}
</style>
