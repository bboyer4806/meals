<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import Sheet from '#lib/components/Sheet.svelte';

	let { data, form } = $props();

	type Item = (typeof data.items)[number];

	let editing = $state<Item | null>(null);
	let open = $state(false);

	function edit(item: Item) {
		editing = item;
		open = true;
	}

	const closeOnSuccess: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') open = false;
		};
	};

	const date = (ms: number) =>
		new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
</script>

<svelte:head>
	<title>Items · Meals</title>
</svelte:head>

<h1>{data.archived ? 'Archived items' : 'Items'}</h1>
<p class="muted">
	Everything you've added to the list. An item's store is the one it was last ordered or bought
	from.
</p>

<form method="GET" class="row search">
	{#if data.archived}<input type="hidden" name="archived" value="1" />{/if}
	<label class="visually-hidden" for="q">Search items</label>
	<input class="grow" id="q" name="q" type="search" placeholder="Search" value={data.search} />
	<button>Search</button>
</form>

<p>
	{#if data.archived}
		<a href="/groceries/items">Show active items</a>
	{:else}
		<a href="/groceries/items?archived=1">Show archived items</a>
	{/if}
</p>

{#if data.items.length === 0}
	<p class="muted">No items{data.search ? ` matching “${data.search}”` : ''}.</p>
{:else}
	<ul class="list card">
		{#each data.items as item (item.id)}
			<li>
				<button class="item" onclick={() => edit(item)}>
					<span class="name">{item.name}</span>
					{#if item.notes}<span class="muted small">{item.notes}</span>{/if}
					<span class="muted small">
						{item.defaultStoreName ?? 'No store yet'}
						{#if item.lastBoughtAt}
							· last bought {date(item.lastBoughtAt)}{item.lastBoughtStoreName
								? ` at ${item.lastBoughtStoreName}`
								: ''}
						{/if}
					</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

<Sheet bind:open title={editing?.name ?? ''}>
	{#if editing}
		{#key editing.id}
			<form method="POST" action="?/update" use:enhance={closeOnSuccess}>
				{#if form?.error}<p class="error" role="alert">{form.error}</p>{/if}
				<input type="hidden" name="id" value={editing.id} />
				<div class="field">
					<label for="item-name">Name</label>
					<input id="item-name" name="name" required maxlength="80" value={editing.name} />
				</div>
				<div class="field">
					<label for="item-notes">Notes</label>
					<input
						id="item-notes"
						name="notes"
						maxlength="200"
						placeholder="Brand, size"
						value={editing.notes ?? ''}
					/>
				</div>
				<div class="row">
					<button class="primary">Save</button>
					{#if editing.archivedAt === null}
						<ConfirmButton
							label="Archive"
							message={`Archive ${editing.name}? It won't be suggested anymore, but it stays in history.`}
							confirmLabel="Archive"
							formaction="?/archive"
						/>
					{:else}
						<button formaction="?/restore">Restore</button>
					{/if}
				</div>
			</form>
		{/key}
	{/if}
</Sheet>

<style>
	.search {
		margin-bottom: 0.5rem;
	}

	.list {
		padding: 0 1rem;
	}

	.item {
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		text-align: left;
		background: none;
		border: none;
		padding: 0.25rem 0;
		font-weight: 400;
	}

	.name {
		font-weight: 700;
	}

	.small {
		font-size: 0.9rem;
	}
</style>
