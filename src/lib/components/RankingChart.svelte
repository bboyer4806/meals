<script lang="ts" module>
	export type RankingRow = {
		key: string | number;
		name: string;
		count: number;
		/** Where tapping the row goes, if anywhere. */
		href?: string;
		/** A line under the bar, such as when a dish was last planned. */
		detail?: string;
	};
</script>

<script lang="ts">
	// A ranked report on Reports (design 7, Reports; MEA-14): a horizontal bar per row, most
	// first, each with its name and count. It shows the top 10, and Show all the rest.

	let { rows, empty }: { rows: RankingRow[]; empty: string } = $props();

	const TOP = 10;
	let showAll = $state(false);
	const shown = $derived(showAll ? rows : rows.slice(0, TOP));
	// The longest bar is the row with the most, whether or not all are shown.
	const most = $derived(rows.reduce((highest, row) => Math.max(highest, row.count), 0));
	const listId = $props.id();
</script>

{#snippet content(row: RankingRow)}
	<span class="label">
		<span class="name">{row.name}</span>
		<span class="count">{row.count}</span>
	</span>
	<span class="bar" style:width="{(row.count / most) * 100}%"></span>
	{#if row.detail}<span class="muted detail">{row.detail}</span>{/if}
{/snippet}

{#if rows.length === 0}
	<p class="muted">{empty}</p>
{:else}
	<ol class="ranking" id={listId}>
		{#each shown as row (row.key)}
			<li>
				{#if row.href}
					<a class="row" href={row.href}>{@render content(row)}</a>
				{:else}
					<div class="row">{@render content(row)}</div>
				{/if}
			</li>
		{/each}
	</ol>
	{#if rows.length > TOP}
		<button
			type="button"
			class="quiet"
			aria-expanded={showAll}
			aria-controls={listId}
			onclick={() => (showAll = !showAll)}
		>
			{showAll ? `Show top ${TOP}` : `Show all ${rows.length}`}
		</button>
	{/if}
{/if}

<style>
	.ranking {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.row {
		display: block;
		padding: 0.375rem 0;
		color: inherit;
		text-decoration: none;
	}

	.label {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}

	/* A long name wraps rather than pushing the count off the screen. */
	.name {
		min-width: 0;
		overflow-wrap: anywhere;
		font-weight: 700;
	}

	/* A row that opens a recipe or an item reads as a link. */
	a .name {
		color: var(--accent);
		text-decoration: underline;
	}

	.count {
		flex: none;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	/* Thin, growing from the left with a rounded end, in one color, since the name and count
	   beside it say what it is. */
	.bar {
		display: block;
		height: 0.625rem;
		min-width: 0.25rem;
		margin-top: 0.25rem;
		border-radius: 0 4px 4px 0;
		background: var(--accent);
	}

	.detail {
		display: block;
		font-size: 0.9rem;
	}
</style>
