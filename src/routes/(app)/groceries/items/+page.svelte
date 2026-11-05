<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import ItemImage, { type ImageChoice } from '#lib/components/ItemImage.svelte';
	import ItemThumb from '#lib/components/ItemThumb.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import SearchBox from '#lib/components/SearchBox.svelte';
	import { formatDateLabel } from '#lib/dates.ts';

	let { data } = $props();

	type Item = (typeof data.items)[number];

	let editing = $state<Item | null>(null);
	let open = $state(false);
	// Rebuilt every time the sheet opens, so edits abandoned last time don't come back.
	let editKey = $state(0);
	let sheetError = $state('');
	let image = $state<ImageChoice>({ kind: 'keep' });
	let preparingImage = $state(false);

	function edit(item: Item) {
		editing = item;
		editKey += 1;
		sheetError = '';
		image = { kind: 'keep' };
		preparingImage = false;
		open = true;
	}

	const submitSheet: SubmitFunction = ({ action, formData, cancel }) => {
		// Save sends the image with the name and notes. Archive and Restore leave it as it is.
		if (action.search === '?/update') {
			if (preparingImage) return cancel();
			if (image.kind === 'new') {
				formData.set('photo', image.photo, 'photo.jpg');
				formData.set('thumb', image.thumb, 'thumb.jpg');
			} else if (image.kind === 'remove') {
				formData.set('removePhoto', '1');
			}
		}
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				sheetError = (result.data as { error?: string } | undefined)?.error ?? 'Please try again.';
				return;
			}
			await update({ reset: false });
			if (result.type === 'success') open = false;
		};
	};
</script>

<svelte:head>
	<title>Items · Meals</title>
</svelte:head>

<a class="link-tap back" href="/groceries">‹ Groceries</a>

<h1>{data.archived ? 'Archived items' : 'Items'}</h1>
<p class="muted">
	Everything you've added to the list. An item's store is the one it was last ordered or bought
	from.
</p>

<form method="GET" class="row search" data-sveltekit-replacestate data-sveltekit-reset="false">
	{#if data.archived}<input type="hidden" name="archived" value="1" />{/if}
	<SearchBox label="Search items" value={data.search} />
</form>

<p>
	{#if data.archived}
		<a class="link-tap" href="/groceries/items">Show active items</a>
	{:else}
		<a class="link-tap" href="/groceries/items?archived=1">Show archived items</a>
	{/if}
</p>

{#if data.items.length === 0}
	<p class="muted">No items{data.search ? ` matching “${data.search}”` : ''}.</p>
{:else}
	<ul class="list card">
		{#each data.items as item (item.id)}
			<li>
				<button class="item" onclick={() => edit(item)}>
					<ItemThumb photoKey={item.photoKey} size={48} />
					<span class="text">
						<span class="name">{item.name}</span>
						{#if item.notes}<span class="muted small">{item.notes}</span>{/if}
						<span class="muted small">
							{item.defaultStoreName ?? 'No store yet'}
							{#if item.lastBoughtDate}
								· last bought {formatDateLabel(item.lastBoughtDate, {
									today: data.today
								})}{item.lastBoughtStoreName
									? ` at ${item.lastBoughtStoreName}`
									: ''}
							{/if}
						</span>
					</span>
				</button>
			</li>
		{/each}
	</ul>
{/if}

<Sheet bind:open title={editing?.name ?? ''}>
	{#if editing}
		{#key editKey}
			<ItemImage savedKey={editing.photoKey} bind:choice={image} bind:busy={preparingImage} />
			<form
				method="POST"
				action="?/update"
				enctype="multipart/form-data"
				use:enhance={submitSheet}
			>
				{#if sheetError}<p class="error" role="alert">{sheetError}</p>{/if}
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
					<button class="primary" disabled={preparingImage}>Save</button>
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
	.back {
		font-weight: 700;
	}

	.search {
		margin-bottom: 0.5rem;
	}

	.list {
		padding: 0 1rem;
	}

	.item {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 0.75rem;
		text-align: left;
		background: none;
		border: none;
		padding: 0.25rem 0;
		font-weight: 400;
	}

	.text {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		min-width: 0;
	}

	.name {
		font-weight: 700;
	}

	.small {
		font-size: 0.9rem;
	}
</style>
