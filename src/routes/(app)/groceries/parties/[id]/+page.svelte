<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import ItemInput from '#lib/components/ItemInput.svelte';
	import ItemThumb from '#lib/components/ItemThumb.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import { foldCase, formatQuantity, normalizeName } from '#lib/text.ts';

	let { data, form } = $props();

	type Thing = (typeof data.list.items)[number];
	type Failure = { error?: string } | undefined;

	const activeStores = $derived(data.stores.filter((store) => store.archivedAt === null));
	// What Add all would add: everything not yet bought or on Groceries (design 6.15).
	const toAdd = $derived(data.list.items.filter((thing) => thing.toAdd > 0));

	function amount(quantity: number, unit: string | null) {
		return unit ? `${formatQuantity(quantity)} ${unit}` : formatQuantity(quantity);
	}

	/** What's bought and what's on Groceries, such as "Bought 1 of 3 bags · On Groceries". */
	function status(thing: Thing): string {
		if (thing.done) return 'Bought';
		const parts: string[] = [];
		if (thing.bought > 0) {
			parts.push(`Bought ${formatQuantity(thing.bought)} of ${amount(thing.quantity, thing.unit)}`);
		}
		if (thing.onGroceries > 0) {
			parts.push(
				thing.toAdd > 0 ? `${amount(thing.onGroceries, thing.unit)} on Groceries` : 'On Groceries'
			);
		}
		return parts.join(' · ');
	}

	function failureMessage(data: unknown) {
		return (data as Failure)?.error ?? 'Something went wrong. Please try again.';
	}

	// The add form. When the name matches an item, the unit used last time is filled in (design
	// 6.4), but never over one the person changed since.

	let itemName = $state('');
	// A number input bound with bind:value holds a number, or null while it's empty.
	let quantity = $state<number | null>(1);
	let unit = $state('');
	let itemInput: HTMLElement;

	const matched = $derived.by(() => {
		const key = foldCase(normalizeName(itemName));
		return data.items.find((item) => foldCase(item.name) === key);
	});
	let filledUnit = '';
	$effect(() => {
		const item = matched;
		untrack(() => {
			const next = item?.lastUnit ?? '';
			if (unit === filledUnit) unit = next;
			filledUnit = next;
		});
	});

	/** Clears the fields that still hold what was sent; someone may have started the next thing. */
	const submitAdd: SubmitFunction = () => {
		const sent = { itemName, quantity, unit };
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type !== 'success') return;
			if (itemName === sent.itemName) itemName = '';
			if (quantity === sent.quantity) quantity = 1;
			if (unit === sent.unit && unit !== filledUnit) unit = '';
			itemInput.querySelector('input')?.focus();
		};
	};

	// One thing's actions. Their errors show next to it or in its sheet, not elsewhere.

	type Where = number | 'sheet' | 'picker';
	let thingError = $state<{ where: Where; message: string } | null>(null);

	function thingFailure(result: ActionResult): string | null {
		if (result.type === 'failure') return failureMessage(result.data);
		// Someone else removed it.
		if (result.type === 'error' && result.status === 404) return 'This is no longer on the list.';
		return null;
	}

	function thingSubmit(where: Where): SubmitFunction {
		return () => {
			return async ({ result, update }) => {
				const message = thingFailure(result);
				if (message !== null) {
					thingError = { where, message };
					// Someone else may have changed it; show the list as it is now.
					await refreshAll();
					return;
				}
				thingError = null;
				await update({ reset: false });
				if (result.type === 'success') {
					editOpen = false;
					pickOpen = false;
				}
			};
		};
	}

	let editing = $state<Thing | null>(null);
	let editOpen = $state(false);
	// Rebuilt every time the sheet opens, so edits abandoned last time don't come back.
	let editKey = $state(0);
	let picking = $state<Thing | null>(null);
	let pickOpen = $state(false);

	function edit(thing: Thing) {
		editing = thing;
		editKey += 1;
		thingError = null;
		editOpen = true;
	}

	function pickStore(thing: Thing) {
		picking = thing;
		thingError = null;
		pickOpen = true;
	}

	/** What Remove asks, saying when the thing comes off Groceries too (design 6.15). */
	function removeQuestion(thing: Thing) {
		const groceries = thing.onGroceries > 0 ? ' It comes off Groceries too.' : '';
		return `Take ${thing.itemName} off ${data.list.name}?${groceries}`;
	}

	// Renaming and deleting the list.

	let listOpen = $state(false);
	let listKey = $state(0);
	let listError = $state('');
	const deleteQuestion = $derived(
		`Delete ${data.list.name}? What's on Groceries for it comes off, ` +
			'and what was bought stays in Grocery History.'
	);

	function editList() {
		listKey += 1;
		listError = '';
		listOpen = true;
	}

	const submitList: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				listError = failureMessage(result.data);
				return;
			}
			await update({ reset: false });
			if (result.type === 'success') listOpen = false;
		};
	};

	/** "Added 3 items to Groceries." */
	function addedMessage(count: number) {
		if (count === 0) return 'Everything was already on Groceries or bought.';
		return `Added ${count} ${count === 1 ? 'item' : 'items'} to Groceries.`;
	}
</script>

<svelte:head>
	<title>{data.list.name} · Meals</title>
</svelte:head>

<a class="link-tap back" href="/groceries/parties">‹ Party lists</a>

<div class="title row">
	<h1 class="grow">{data.list.name}</h1>
	<button class="quiet" onclick={editList}>Edit</button>
</div>

<form
	class="add card"
	method="POST"
	action="?/add"
	use:enhance={submitAdd}
	aria-label="Add to the party list"
>
	<div bind:this={itemInput}>
		<label class="visually-hidden" for="itemName">Item</label>
		<ItemInput
			id="itemName"
			name="itemName"
			placeholder="Add food, drinks or supplies"
			items={data.items}
			bind:value={itemName}
		/>
	</div>
	<div class="row">
		<label class="visually-hidden" for="quantity">Quantity</label>
		<input
			class="qty"
			id="quantity"
			name="quantity"
			type="number"
			inputmode="decimal"
			step="any"
			min="0"
			required
			bind:value={quantity}
		/>
		<label class="visually-hidden" for="unit">Unit</label>
		<input class="grow" id="unit" name="unit" maxlength="20" placeholder="Unit" bind:value={unit} />
		<button class="primary">Add</button>
	</div>
	{#if form?.action === 'add' && form.error}<p class="error" role="alert">{form.error}</p>{/if}
</form>

{#if toAdd.length > 0}
	<form class="add-all" method="POST" action="?/addAllToGroceries" use:enhance>
		<input type="hidden" name="ids" value={toAdd.map((thing) => thing.id).join(',')} />
		<ConfirmButton
			label="Add all to Groceries"
			message={`Add ${toAdd.length} ${toAdd.length === 1 ? 'item' : 'items'} to Groceries?`}
			confirmLabel="Add to Groceries"
		/>
	</form>
{/if}
{#if form?.action === 'all' && form.added !== undefined}
	<p role="status">{addedMessage(form.added)}</p>
{/if}
{#if (form?.action === 'all' || form?.action === 'thing') && form.error}
	<p class="error" role="alert">{form.error}</p>
{/if}

{#if data.list.items.length === 0}
	<p class="empty muted">Nothing on this list yet. Add something above.</p>
{:else}
	<ul class="lines card">
		{#each data.list.items as thing (thing.id)}
			<li class="line" class:done={thing.done}>
				{#if thing.done}
					<form method="POST" action="?/unbuy" use:enhance={thingSubmit(thing.id)}>
						<input type="hidden" name="id" value={thing.id} />
						<button class="check" aria-label="Undo bought: {thing.itemName}">
							<span class="circle checked" aria-hidden="true">✓</span>
						</button>
					</form>
				{:else if thing.needsStore}
					<button
						class="check"
						aria-label="Mark bought: {thing.itemName}"
						onclick={() => pickStore(thing)}
					>
						<span class="circle" aria-hidden="true"></span>
					</button>
				{:else}
					<form method="POST" action="?/buy" use:enhance={thingSubmit(thing.id)}>
						<input type="hidden" name="id" value={thing.id} />
						<button class="check" aria-label="Mark bought: {thing.itemName}">
							<span class="circle" aria-hidden="true"></span>
						</button>
					</form>
				{/if}
				<button class="body" onclick={() => edit(thing)}>
					<ItemThumb photoKey={thing.itemPhotoKey} size={40} />
					<span class="text">
						<span class="name">{thing.itemName}</span>
						<span class="amount">{amount(thing.quantity, thing.unit)}</span>
						{#if thing.itemNotes}<span class="notes muted">{thing.itemNotes}</span>{/if}
						{#if status(thing)}<span class="notes">{status(thing)}</span>{/if}
					</span>
				</button>
				{#if thing.toAdd > 0}
					<form
						class="to-groceries"
						method="POST"
						action="?/addToGroceries"
						use:enhance={thingSubmit(thing.id)}
					>
						<input type="hidden" name="id" value={thing.id} />
						<button class="quiet" aria-label="Add to Groceries: {thing.itemName}">
							Add to Groceries
						</button>
					</form>
				{/if}
				{#if thingError?.where === thing.id}
					<p class="error line-error" role="alert">{thingError.message}</p>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<Sheet bind:open={pickOpen} title="Where did you get it?">
	{#if picking}
		<p>{picking.itemName} is on Groceries without a store.</p>
		{#if thingError?.where === 'picker'}<p class="error" role="alert">{thingError.message}</p>{/if}
		{#if activeStores.length === 0}
			<p>Add your stores on the <a class="link-tap" href="/household">Household</a> page first.</p>
		{:else}
			<form method="POST" action="?/buy" use:enhance={thingSubmit('picker')} class="stores">
				<input type="hidden" name="id" value={picking.id} />
				{#each activeStores as option (option.id)}
					<button name="store" value={option.id}>{option.name}</button>
				{/each}
			</form>
		{/if}
	{/if}
</Sheet>

<Sheet bind:open={editOpen} title={editing?.itemName ?? ''}>
	{#if editing}
		{#key editKey}
			<form method="POST" action="?/quantity" use:enhance={thingSubmit('sheet')}>
				{#if thingError?.where === 'sheet'}<p class="error" role="alert">{thingError.message}</p>{/if}
				<input type="hidden" name="id" value={editing.id} />
				<label for="edit-quantity">How much the party needs</label>
				<div class="row field">
					<input
						class="qty"
						id="edit-quantity"
						name="quantity"
						type="number"
						inputmode="decimal"
						step="any"
						min="0"
						required
						value={editing.quantity}
					/>
					{#if editing.unit}<span>{editing.unit}</span>{/if}
				</div>
				{#if editing.onGroceries > 0}
					<p class="muted">What's on Groceries for it changes to match.</p>
				{/if}
				<div class="row actions">
					<button class="primary">Save</button>
				</div>
				<div class="delete">
					<ConfirmButton
						label="Remove"
						message={removeQuestion(editing)}
						confirmLabel="Remove"
						formaction="?/remove"
						danger
					/>
				</div>
			</form>
		{/key}
	{/if}
</Sheet>

<Sheet bind:open={listOpen} title="Edit party list">
	{#key listKey}
		<form method="POST" action="?/rename" use:enhance={submitList}>
			{#if listError}<p class="error" role="alert">{listError}</p>{/if}
			<div class="field">
				<label for="list-name">Name</label>
				<input id="list-name" name="name" required maxlength="60" value={data.list.name} />
			</div>
			<div class="row">
				<button class="primary">Save</button>
				<ConfirmButton
					label="Delete list"
					message={deleteQuestion}
					confirmLabel="Delete list"
					formaction="?/delete"
					danger
				/>
			</div>
		</form>
	{/key}
</Sheet>

<style>
	.back {
		font-weight: 700;
	}

	.title h1 {
		margin: 0;
		overflow-wrap: anywhere;
	}

	.add {
		display: grid;
		gap: 0.5rem;
	}

	.qty {
		width: 5.5rem;
		flex: none;
	}

	.add-all {
		margin-bottom: 1rem;
	}

	.empty {
		text-align: center;
		padding: 2rem 0;
	}

	.lines {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0.25rem 1rem;
	}

	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		border-top: 1px solid var(--border);
	}

	.line:first-child {
		border-top: none;
	}

	.line-error {
		flex-basis: 100%;
		margin: 0 0 0.5rem;
	}

	.check {
		width: var(--tap);
		height: var(--tap);
		padding: 0;
		border: none;
		background: none;
		flex: none;
	}

	.circle {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 2px solid var(--muted);
		font-size: 0.9rem;
		line-height: 1;
	}

	.circle.checked {
		background: var(--received);
		border-color: var(--received);
		color: var(--surface);
	}

	/* The item's image, if it has one, beside the thing's text. */
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		justify-content: flex-start;
		text-align: left;
		background: none;
		border: none;
		padding: 0.6rem 0.25rem;
		font-weight: 400;
		min-height: var(--tap);
	}

	/* A long name without spaces wraps rather than widening the list past the screen. */
	.text {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 0.5rem;
	}

	.name {
		font-weight: 700;
	}

	.amount {
		color: var(--muted);
	}

	.notes {
		flex-basis: 100%;
		font-size: 0.9rem;
	}

	.done .name {
		text-decoration: line-through;
		color: var(--muted);
	}

	/* Under the thing's text, lined up with it. */
	.to-groceries {
		flex-basis: 100%;
		padding-left: var(--tap);
		margin-top: -0.5rem;
	}

	.actions {
		margin-top: 0.75rem;
	}

	.delete {
		margin-top: 1rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}

	.stores {
		display: grid;
		gap: 0.5rem;
	}
</style>
