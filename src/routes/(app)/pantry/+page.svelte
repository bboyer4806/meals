<script lang="ts">
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import { servingsLabel } from '#lib/recipe-view.ts';

	let { data, form } = $props();

	type Item = NonNullable<typeof data.checklist>['items'][number];
	type Failure = { error?: string } | undefined;

	const checklist = $derived(data.checklist);
	// Items already on the grocery list need nothing, so they aren't counted as left to check.
	const toCheck = $derived(
		checklist?.items.filter((item) => item.state.kind !== 'onList').length ?? 0
	);
	const anyNeed = $derived(checklist?.items.some((item) => item.state.kind === 'need') ?? false);

	const STATUS = { to_order: 'To Order', ordered: 'Ordered', received: 'Received' } as const;

	/** The line's totals (6.8): "1 1/8 cups + 2 cloves", "1 cup + some" or "No amount". */
	function totals({ totals, unmeasured }: Item['amounts']): string {
		if (totals.length === 0) return 'No amount';
		return totals.join(' + ') + (unmeasured ? ' + some' : '');
	}

	const startOverQuestion = $derived.by(() => {
		const marked = checklist?.markedCount ?? 0;
		return (
			`Clear the ${marked} checked ${marked === 1 ? 'item' : 'items'}? ` +
			'Anything Need added stays on the grocery list.'
		);
	});

	// One item's actions. Their errors show next to the item, or at the top if it's gone.

	let itemError = $state<{ itemId: number; message: string } | null>(null);
	// Items with a request on its way, so a double tap doesn't send a second one.
	const busy = new SvelteSet<number>();

	const lostError = $derived(
		itemError !== null && !checklist?.items.some((item) => item.itemId === itemError?.itemId)
			? itemError.message
			: null
	);

	function itemFailure(result: ActionResult): string | null {
		if (result.type === 'failure') {
			return (result.data as Failure)?.error ?? 'Something went wrong. Please try again.';
		}
		if (result.type === 'error' && result.status === 404) {
			return 'This item is no longer in the pantry check.';
		}
		return null;
	}

	function itemSubmit(itemId: number): SubmitFunction {
		return ({ cancel }) => {
			// Two taps can land before the buttons are disabled.
			if (busy.has(itemId)) return cancel();
			busy.add(itemId);
			return async ({ result, update }) => {
				try {
					const message = itemFailure(result);
					if (message !== null) {
						itemError = { itemId, message };
						// Someone else may have checked it or started a new check; show it as it is now.
						await refreshAll();
						return;
					}
					itemError = null;
					await update({ reset: false });
				} finally {
					busy.delete(itemId);
				}
			};
		};
	}
</script>

<svelte:head>
	<title>Pantry check · Meals</title>
</svelte:head>

<div class="title row">
	<h1 class="grow">Pantry check</h1>
	{#if anyNeed}<a class="link-tap" href="/groceries">Grocery list</a>{/if}
</div>

{#if (form?.action === 'start' || form?.action === 'checklist' || form?.action === 'item') && form.error}
	<p class="error" role="alert">{form.error}</p>
{/if}
{#if lostError}<p class="error" role="alert">{lostError}</p>{/if}

{#if !checklist}
	<p class="empty muted">No pantry check yet. Open a recipe and tap Check pantry.</p>
{:else}
	{@const { source } = checklist}
	<p class="source">
		<a class="link-tap" href="/recipes/{source.dishId}?servings={source.servings}">
			{source.dishName}, {servingsLabel(source.servings)}
		</a>
	</p>
	{#if toCheck > 0}
		<p class="count muted" role="status">{checklist.markedCount} of {toCheck} checked</p>
	{/if}

	{#if checklist.items.length > 0}
		<ul class="items card">
			{#each checklist.items as item (item.itemId)}
				{@render row(item)}
			{/each}
		</ul>
	{:else if checklist.noIngredients.length === 0}
		<p class="muted">Nothing to check. Every ingredient is marked Always have.</p>
	{/if}

	{#if checklist.noIngredients.length > 0}
		<p class="muted">No ingredients yet: {checklist.noIngredients.join(', ')}</p>
	{/if}

	{#if checklist.markedCount > 0}
		<form class="start-over" method="POST" action="?/startOver" use:enhance>
			<ConfirmButton label="Start over" message={startOverQuestion} confirmLabel="Start over" />
		</form>
	{/if}
{/if}

{#snippet row(item: Item)}
	{@const { state } = item}
	<li class="item" class:checked={state.kind !== 'open'}>
		<div class="text">
			<span class="name">{item.itemName}</span>
			<span class="amount">{totals(item.amounts)}</span>
			{#if item.amounts.breakdown.length > 1}
				<ul class="breakdown">
					{#each item.amounts.breakdown as entry, index (index)}
						<li>{entry.amount ?? 'Some'} for {entry.source}</li>
					{/each}
				</ul>
			{/if}
			{#if item.itemNotes}<span class="notes muted">{item.itemNotes}</span>{/if}
		</div>

		{#if state.kind === 'onList'}
			<!-- Nothing to do: it's already being bought. -->
			<div class="state">
				<span class="mark">
					Already on the list
					<span class="status {state.status}">{STATUS[state.status]}</span>
				</span>
			</div>
		{:else}
			<form
				class="state"
				method="POST"
				action={state.kind === 'open' ? '?/have' : '?/undo'}
				use:enhance={itemSubmit(item.itemId)}
			>
				<input type="hidden" name="itemId" value={item.itemId} />
				{#if state.kind === 'open'}
					<button aria-label="Have {item.itemName}" disabled={busy.has(item.itemId)}>Have</button>
					<button
						formaction="?/need"
						aria-label="Need {item.itemName}"
						disabled={busy.has(item.itemId)}>Need</button
					>
				{:else}
					{#if state.kind === 'have'}
						<span class="mark have">✓ Have</span>
					{:else}
						<span class="mark">
							On the list
							<span class="status {state.status}">{STATUS[state.status]}</span>
						</span>
					{/if}
					<button
						aria-label="Undo {state.kind === 'have' ? 'Have' : 'Need'} for {item.itemName}"
						disabled={busy.has(item.itemId)}>Undo</button
					>
				{/if}
			</form>
		{/if}

		{#if itemError?.itemId === item.itemId}
			<p class="error item-error" role="alert">{itemError.message}</p>
		{/if}
	</li>
{/snippet}

<style>
	.title {
		margin-bottom: 0.25rem;
	}

	.title h1 {
		margin: 0;
	}

	.title a {
		font-weight: 700;
	}

	.empty {
		text-align: center;
		padding: 2rem 0;
	}

	.source {
		margin: 0;
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.count {
		margin: 0 0 0.75rem;
	}

	.items {
		list-style: none;
		padding: 0 1rem;
	}

	.item {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem 0.75rem;
		padding: 0.6rem 0;
		border-top: 1px solid var(--border);
	}

	.item:first-child {
		border-top: none;
	}

	.text {
		flex: 1 1 9rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
		overflow-wrap: anywhere;
	}

	.name {
		font-weight: 700;
	}

	.checked .name,
	.checked .amount {
		color: var(--muted);
	}

	.breakdown {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 0.9rem;
		color: var(--muted);
	}

	.notes {
		font-size: 0.9rem;
	}

	/* Beside the text, or under it on the right when the text needs the room. */
	.state {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-left: auto;
	}

	.state button {
		min-width: 4.5rem;
	}

	.mark {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		font-weight: 700;
		text-align: right;
	}

	.mark.have {
		color: var(--received);
	}

	.status {
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}

	.status.ordered {
		color: var(--ordered);
	}

	.status.received {
		color: var(--received);
	}

	.item-error {
		flex-basis: 100%;
		margin: 0;
	}

	.start-over {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
</style>
