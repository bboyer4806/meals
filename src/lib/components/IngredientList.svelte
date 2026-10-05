<script lang="ts">
	import { groupBySection, type IngredientRow } from '../recipe-view.ts';
	import { showAmount } from '../scaling.ts';

	// A recipe's ingredients under their section headings, scaled by `factor` (design 6.6). In the
	// cooking view (`checkable`) each one is checked off with a tap; the checks aren't saved (2.3).
	let {
		ingredients,
		factor,
		checkable = false
	}: { ingredients: IngredientRow[]; factor: number; checkable?: boolean } = $props();

	const groups = $derived(groupBySection(ingredients));
	let checked = $state<Record<number, boolean>>({});
</script>

{#each groups as group}
	{#if group.section}<h3>{group.section}</h3>{/if}
	<ul class:checkable>
		{#each group.rows as row (row.id)}
			{@const amount = showAmount(row.amount, row.unit, factor)}
			<li>
				{#if checkable}
					<label class="check-off" class:done={checked[row.id]}>
						<input type="checkbox" bind:checked={checked[row.id]} />
						<span>{@render text(row, amount)}</span>
					</label>
				{:else}
					{@render text(row, amount)}
				{/if}
			</li>
		{/each}
	</ul>
{/each}

{#snippet text(row: IngredientRow, amount: string | null)}
	{#if amount}<strong>{amount}</strong>{/if}
	{row.itemName}{#if row.prepNote}<span class="muted">, {row.prepNote}</span>{/if}
{/snippet}

<style>
	h3 {
		font-family: var(--font-body);
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
		margin: 0.75rem 0 0.25rem;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		padding: 0.35rem 0;
		border-top: 1px solid var(--border);
		overflow-wrap: anywhere;
	}

	li:first-child {
		border-top: none;
	}

	.checkable li {
		padding: 0;
	}
</style>
