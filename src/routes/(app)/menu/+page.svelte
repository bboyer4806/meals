<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { formatDateLabel } from '#lib/dates.ts';
	import { DINNER_TYPE_LABELS, DISH_ROLE_LABELS, hasDishes } from '#lib/menu.ts';

	let { data } = $props();

	// Saving a dinner's servings and note comes here with ?saved=<its date> (design 7, Dinner),
	// and that day's row says "Saved" for 3 seconds. The address drops it straight away, so a
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
</script>

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
					<!-- Always there, so a screen reader announces "Saved" when it appears. -->
					<span class="saved" role="status">{saved === day.date ? 'Saved' : ''}</span>
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
</style>
