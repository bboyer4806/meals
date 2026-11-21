<script lang="ts">
	import RankingChart from '#lib/components/RankingChart.svelte';
	import { formatDateLabel } from '#lib/dates.ts';
	import { DINNER_TYPE_LABELS, type DinnerType } from '#lib/menu.ts';
	import {
		FAVORITE_TIMES,
		FORGOTTEN_DAYS,
		formatShare,
		REPORT_PERIOD_LABELS,
		REPORT_PERIODS
	} from '#lib/reports.ts';

	let { data } = $props();

	/** In the order MEA-14 lists them. */
	const BREAKDOWN: DinnerType[] = ['cook', 'eat_out', 'leftovers', 'going'];
	const dinnerTotal = $derived(BREAKDOWN.reduce((sum, type) => sum + data.dinnerTypes[type], 0));

	const dishRows = $derived(
		data.dishes.map(({ id, name, count }) => ({ key: id, name, count, href: `/recipes/${id}` }))
	);
	// An item opens in its sheet on Items, archived or not (design 7, Items).
	const groceryRows = $derived(
		data.groceries.map(({ id, name, count }) => ({
			key: id,
			name,
			count,
			href: `/groceries/items?item=${id}`
		}))
	);
	const restaurantRows = $derived(
		data.restaurants.map(({ name, count }) => ({ key: name, name, count }))
	);
	const forgottenRows = $derived(
		data.forgotten.map(({ id, name, count, lastPlanned }) => ({
			key: id,
			name,
			count,
			href: `/recipes/${id}`,
			detail: `Last planned ${formatDateLabel(lastPlanned, { today: data.today })}`
		}))
	);
</script>

<svelte:head>
	<title>Reports · Meals</title>
</svelte:head>

<h1>Reports</h1>
<p class="muted">
	Your household's habits, from the Menu and Grocery History. Dinners planned for later dates don't
	count yet.
</p>

<ul class="periods" aria-label="Period">
	{#each REPORT_PERIODS as period (period)}
		<li>
			<a
				class="button"
				href="?period={period}"
				aria-current={data.period === period ? 'true' : undefined}
				>{REPORT_PERIOD_LABELS[period]}</a
			>
		</li>
	{/each}
</ul>

<!-- Each period starts with the top 10 of each report. -->
{#key data.period}
	<section class="card" aria-labelledby="dishes">
		<h2 id="dishes">Most Frequently Planned Dishes</h2>
		<p class="muted">How many dinners each dish was on.</p>
		<RankingChart rows={dishRows} empty="No dishes were planned in this period." />
	</section>

	<section class="card" aria-labelledby="groceries">
		<h2 id="groceries">Most Frequently Purchased Groceries</h2>
		<p class="muted">How many times each item was checked off as received.</p>
		<RankingChart rows={groceryRows} empty="Nothing was received in this period." />
	</section>

	<section class="card" aria-labelledby="restaurants">
		<h2 id="restaurants">Most Popular Restaurants</h2>
		<p class="muted">How many Eating out dinners went to each restaurant.</p>
		<RankingChart
			rows={restaurantRows}
			empty="No Eating out dinners with a restaurant in this period."
		/>
	</section>

	<section class="card" aria-labelledby="breakdown">
		<h2 id="breakdown">Dinner Breakdown</h2>
		{#if dinnerTotal === 0}
			<p class="muted">No dinners were planned in this period.</p>
		{:else}
			<p class="muted">
				The share of this period's {dinnerTotal}
				{dinnerTotal === 1 ? 'dinner' : 'dinners'} of each type.
			</p>
			<ul class="meters">
				{#each BREAKDOWN as type (type)}
					{@const count = data.dinnerTypes[type]}
					<li>
						<span class="label">
							<span class="name">{DINNER_TYPE_LABELS[type]}</span>
							<span>
								<strong>{formatShare(count, dinnerTotal)}</strong>
								<span class="muted">· {count} {count === 1 ? 'dinner' : 'dinners'}</span>
							</span>
						</span>
						<!-- The track is every dinner, and the fill this type's share. -->
						<span class="track"
							><span class="fill" style:width="{(count / dinnerTotal) * 100}%"></span></span
						>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/key}

<section class="card" aria-labelledby="forgotten">
	<h2 id="forgotten">Forgotten Favorites</h2>
	<p class="muted">
		Dishes planned at least {FAVORITE_TIMES} times, but not in the last {FORGOTTEN_DAYS} days or for a
		later date, whatever the period above.
	</p>
	<RankingChart rows={forgottenRows} empty="No forgotten favorites right now." />
</section>

<style>
	/* Like the Recipes page's views, the current period is filled in, not only colored. Two to a
	   row on a phone, so each name fits on one line. */
	.periods {
		list-style: none;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.5rem;
		margin: 0 0 1rem;
		padding: 0;
	}

	@media (min-width: 36rem) {
		.periods {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
	}

	.periods .button {
		width: 100%;
		padding-inline: 0.5rem;
		text-align: center;
	}

	.periods [aria-current='true'] {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}

	.meters {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.meters li {
		padding: 0.375rem 0;
	}

	.label {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}

	.name {
		font-weight: 700;
	}

	.label > :last-child {
		flex: none;
	}

	.track {
		display: block;
		height: 0.625rem;
		margin-top: 0.25rem;
		border-radius: 4px;
		background: var(--border);
		overflow: hidden;
	}

	.fill {
		display: block;
		height: 100%;
		background: var(--accent);
	}
</style>
