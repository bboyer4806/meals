<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import ItemInput from '#lib/components/ItemInput.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import { formatQuantity } from '#lib/text.ts';

	let { data, form } = $props();

	type Line = (typeof data.groups)[number]['toOrder'][number];
	type PickerItem = (typeof data.items)[number];

	const activeStores = $derived(data.stores.filter((store) => store.archivedAt === null));

	function amount(line: { quantity: number; unit: string | null }) {
		return line.unit ? `${formatQuantity(line.quantity)} ${line.unit}` : formatQuantity(line.quantity);
	}

	// Add bar

	let itemName = $state('');
	// A number input bound with bind:value holds a number, or null while it's empty.
	let quantity = $state<number | null>(1);
	let unit = $state('');
	let store = $state('usual');
	let itemInput: HTMLElement;

	function pickItem(item: PickerItem) {
		store = item.defaultStoreId === null ? 'usual' : String(item.defaultStoreId);
		if (unit === '' && item.lastUnit) unit = item.lastUnit;
	}

	type Prompt = Extract<NonNullable<typeof form>, { prompt: unknown }>['prompt'];
	let prompt = $state<Prompt | null>(null);
	let promptOpen = $state(false);

	const submitAdd: SubmitFunction = () => {
		// Someone may start typing the next item before this one is saved, so only clear the
		// fields that still hold what was sent.
		const sent = { itemName, quantity, unit, store };
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type !== 'success') return;
			const data = result.data as { prompt?: Prompt } | undefined;
			if (data?.prompt) {
				prompt = data.prompt;
				promptOpen = true;
				return;
			}
			promptOpen = false;
			if (itemName === sent.itemName) itemName = '';
			if (quantity === sent.quantity) quantity = 1;
			if (unit === sent.unit) unit = '';
			if (store === sent.store) store = 'usual';
			itemInput.querySelector('input')?.focus();
		};
	};

	// Sheets for one line

	let editing = $state<Line | null>(null);
	let editOpen = $state(false);
	let showFewer = $state(false);
	let picking = $state<Line | null>(null);
	let pickOpen = $state(false);

	function edit(line: Line) {
		editing = line;
		showFewer = false;
		editOpen = true;
	}

	function pickStore(line: Line) {
		picking = line;
		pickOpen = true;
	}

	const closeOnSuccess: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type === 'success') {
				editOpen = false;
				pickOpen = false;
			}
		};
	};

	// Collapsed groups are remembered on this device only.

	const COLLAPSED_KEY = 'collapsedGroups';
	let collapsed = $state<Record<string, boolean>>({});

	$effect(() => {
		try {
			collapsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}');
		} catch {
			collapsed = {};
		}
	});

	function toggle(key: string, open: boolean) {
		collapsed[key] = !open;
		try {
			localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
		} catch {
			// Storage can be unavailable (private browsing); collapsing still works for now.
		}
	}

	const lineCount = $derived(
		data.groups.reduce((sum, group) => sum + group.toOrder.length + group.ordered.length, 0)
	);
</script>

<svelte:head>
	<title>Groceries · Meals</title>
</svelte:head>

<div class="title row">
	<h1 class="grow">Groceries</h1>
	<a href="/groceries/items">Items</a>
	<a href="/groceries/history">History</a>
</div>

<form
	class="add card"
	method="POST"
	action="?/add"
	use:enhance={submitAdd}
	aria-label="Add to the list"
>
	<div bind:this={itemInput}>
		<label class="visually-hidden" for="itemName">Item</label>
		<ItemInput
			id="itemName"
			name="itemName"
			placeholder="Add an item"
			items={data.items}
			bind:value={itemName}
			onpick={pickItem}
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
		<input class="unit" id="unit" name="unit" maxlength="20" placeholder="Unit" bind:value={unit} />
		<label class="visually-hidden" for="store">Store</label>
		<select class="grow" id="store" name="store" bind:value={store}>
			<option value="usual">Usual store</option>
			{#each activeStores as option (option.id)}
				<option value={String(option.id)}>{option.name}</option>
			{/each}
			<option value="none">No store</option>
		</select>
	</div>
	<input type="hidden" name="resolution" value="none" />
	<button class="primary">Add</button>
	{#if form?.action === 'add' && form.error}<p class="error" role="alert">{form.error}</p>{/if}
</form>

{#if form?.action !== 'add' && form?.error && !editOpen && !pickOpen}
	<p class="error" role="alert">{form.error}</p>
{/if}

{#if lineCount === 0 && data.groups.length === 0}
	<p class="empty muted">Nothing on the list. Add something above.</p>
{/if}

{#each data.groups as group (group.key)}
	<details
		class="group card"
		open={!collapsed[group.key]}
		ontoggle={(event) => toggle(group.key, event.currentTarget.open)}
	>
		<summary>
			<h2>{group.name}</h2>
			<span class="muted">{group.toOrder.length + group.ordered.length}</span>
		</summary>

		{#if group.storeId !== null && (group.toOrder.length > 0 || group.ordered.length > 0)}
			<div class="group-actions row">
				{#if group.toOrder.length > 0}
					<form method="POST" action="?/orderAll" use:enhance>
						<input type="hidden" name="storeId" value={group.storeId} />
						<ConfirmButton
							label="Mark all ordered"
							message={`Mark ${group.toOrder.length} ${group.name} ${group.toOrder.length === 1 ? 'item' : 'items'} as ordered?`}
							confirmLabel="Mark ordered"
						/>
					</form>
				{/if}
				{#if group.ordered.length > 0}
					<form method="POST" action="?/receiveAll" use:enhance>
						<input type="hidden" name="storeId" value={group.storeId} />
						<ConfirmButton
							label="Mark all received"
							message={`Mark ${group.ordered.length} ordered ${group.name} ${group.ordered.length === 1 ? 'item' : 'items'} as received?`}
							confirmLabel="Mark received"
						/>
					</form>
				{/if}
			</div>
		{/if}

		{#if group.toOrder.length > 0}
			<ul class="lines">
				{#each group.toOrder as line (line.id)}
					{@render row(line)}
				{/each}
			</ul>
		{/if}
		{#if group.ordered.length > 0}
			<h3 class="status ordered">Ordered</h3>
			<ul class="lines">
				{#each group.ordered as line (line.id)}
					{@render row(line)}
				{/each}
			</ul>
		{/if}
		{#if group.received.length > 0}
			<h3 class="status received">Received today</h3>
			<ul class="lines">
				{#each group.received as line (line.id)}
					{@render row(line)}
				{/each}
			</ul>
		{/if}
	</details>
{/each}

{#snippet row(line: Line)}
	<li class="line" class:done={line.status === 'received'}>
		{#if line.status === 'received'}
			<form method="POST" action="?/undoReceive" use:enhance>
				<input type="hidden" name="id" value={line.id} />
				<button class="check" aria-label="Undo received: {line.itemName}">
					<span class="circle checked" aria-hidden="true">✓</span>
				</button>
			</form>
		{:else if line.storeId === null}
			<button class="check" aria-label="Mark received: {line.itemName}" onclick={() => pickStore(line)}>
				<span class="circle" aria-hidden="true"></span>
			</button>
		{:else}
			<form method="POST" action="?/receive" use:enhance>
				<input type="hidden" name="id" value={line.id} />
				<button class="check" aria-label="Mark received: {line.itemName}">
					<span class="circle" aria-hidden="true"></span>
				</button>
			</form>
		{/if}
		{#if line.status === 'received'}
			<div class="body">{@render lineText(line)}</div>
		{:else}
			<button class="body" onclick={() => edit(line)}>{@render lineText(line)}</button>
		{/if}
	</li>
{/snippet}

{#snippet lineText(line: Line)}
	<span class="name">{line.itemName}</span>
	<span class="amount">{amount(line)}</span>
	{#if line.itemNotes}<span class="notes muted">{line.itemNotes}</span>{/if}
	{#if line.note}<span class="notes">{line.note}</span>{/if}
{/snippet}

<Sheet bind:open={promptOpen} title={prompt?.itemName ?? ''}>
	{#if prompt?.kind === 'duplicate' && prompt.status === 'to_order'}
		<p>
			Already on the list: {amount(prompt)}{prompt.storeName ? ` at ${prompt.storeName}` : ''}.
		</p>
		<form method="POST" action="?/add" use:enhance={submitAdd}>
			<input type="hidden" name="itemName" value={prompt.asked.itemName} />
			<input type="hidden" name="store" value={prompt.asked.store} />
			<input type="hidden" name="resolution" value="update" />
			<p><strong>Change it to</strong></p>
			<div class="row">
				<label class="visually-hidden" for="merge-quantity">Quantity</label>
				<input
					class="qty"
					id="merge-quantity"
					name="quantity"
					type="number"
					inputmode="decimal"
					step="any"
					min="0"
					required
					value={prompt.suggestedQuantity}
				/>
				<label class="visually-hidden" for="merge-unit">Unit</label>
				<input
					class="unit grow"
					id="merge-unit"
					name="unit"
					maxlength="20"
					placeholder="Unit"
					value={prompt.asked.unit ?? ''}
				/>
			</div>
			<div class="row actions">
				<button class="primary">Update</button>
				<button type="button" onclick={() => (promptOpen = false)}>Cancel</button>
			</div>
		</form>
	{:else if prompt?.kind === 'duplicate'}
		<p>
			Already ordered: {amount(prompt)}{prompt.storeName ? ` from ${prompt.storeName}` : ''}.
		</p>
		<form method="POST" action="?/add" use:enhance={submitAdd}>
			{@render askedFields(prompt.asked, 'add')}
			<div class="row actions">
				<button class="primary">Add {amount(prompt.asked)} more to order</button>
				<button type="button" onclick={() => (promptOpen = false)}>Cancel</button>
			</div>
		</form>
	{:else if prompt?.kind === 'archived'}
		<p>{prompt.itemName} is archived. Restore it and add it to the list?</p>
		<form method="POST" action="?/add" use:enhance={submitAdd}>
			{@render askedFields(prompt.asked, 'restore')}
			<div class="row actions">
				<button class="primary">Restore and add</button>
				<button type="button" onclick={() => (promptOpen = false)}>Cancel</button>
			</div>
		</form>
	{/if}
</Sheet>

{#snippet askedFields(
	asked: { itemName: string; quantity: number; unit: string | null; store: string },
	resolution: string
)}
	<input type="hidden" name="itemName" value={asked.itemName} />
	<input type="hidden" name="quantity" value={asked.quantity} />
	<input type="hidden" name="unit" value={asked.unit ?? ''} />
	<input type="hidden" name="store" value={asked.store} />
	<input type="hidden" name="resolution" value={resolution} />
{/snippet}

<Sheet bind:open={pickOpen} title="Where did you get it?">
	{#if picking}
		<p>{picking.itemName} doesn't have a store yet.</p>
		{#if form?.action === 'line' && form.error}<p class="error" role="alert">{form.error}</p>{/if}
		{#if activeStores.length === 0}
			<p>Add your stores on the <a href="/household">Household</a> page first.</p>
		{:else}
			<form method="POST" action="?/receive" use:enhance={closeOnSuccess} class="stores">
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
		{#key editing.id}
			<form method="POST" action="?/update" use:enhance={closeOnSuccess}>
				{#if form?.action === 'line' && form.error}<p class="error" role="alert">{form.error}</p>{/if}
				<input type="hidden" name="id" value={editing.id} />
				<div class="row field">
					<div>
						<label for="edit-quantity">Quantity</label>
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
					</div>
					<div class="grow">
						<label for="edit-unit">Unit</label>
						<input id="edit-unit" name="unit" maxlength="20" value={editing.unit ?? ''} />
					</div>
				</div>
				<div class="field">
					<label for="edit-store">Store</label>
					<select id="edit-store" name="store">
						{#if editing.status === 'to_order'}
							<option value="none" selected={editing.storeId === null}>No store</option>
						{/if}
						{#each data.stores.filter((s) => s.archivedAt === null || s.id === editing?.storeId) as option (option.id)}
							<option value={option.id} selected={option.id === editing.storeId}>{option.name}</option>
						{/each}
					</select>
				</div>
				<div class="field">
					<label for="edit-note">Note</label>
					<input
						id="edit-note"
						name="note"
						maxlength="200"
						placeholder="Brand, size, substitution"
						value={editing.note ?? ''}
					/>
				</div>
				<div class="row actions wrap">
					<button class="primary">Save</button>
					{#if editing.status === 'to_order'}
						<button formaction="?/order">Mark ordered</button>
					{:else}
						<button formaction="?/didntCome">Didn't come</button>
					{/if}
					<button type="button" onclick={() => (showFewer = !showFewer)}>Got fewer</button>
				</div>
				{#if showFewer}
					<div class="fewer row">
						<label class="grow" for="received-quantity">How many did you get?</label>
						<input
							class="qty"
							id="received-quantity"
							name="receivedQuantity"
							type="number"
							inputmode="decimal"
							step="any"
							min="0"
						/>
						<button formaction="?/gotFewer">Save</button>
					</div>
				{/if}
				<div class="delete">
					<ConfirmButton
						label="Delete"
						message={`Take ${editing.itemName} off the list?`}
						confirmLabel="Delete"
						formaction="?/delete"
						danger
					/>
				</div>
			</form>
		{/key}
	{/if}
</Sheet>

<style>
	.title {
		margin-bottom: 0.5rem;
	}

	.title h1 {
		margin: 0;
	}

	.title a {
		font-weight: 700;
	}

	.add {
		display: grid;
		gap: 0.5rem;
	}

	.qty {
		width: 5.5rem;
		flex: none;
	}

	.unit {
		width: 6rem;
		flex: none;
	}

	.empty {
		text-align: center;
		padding: 2rem 0;
	}

	.group {
		padding: 0.25rem 1rem 0.75rem;
	}

	summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--tap);
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary::before {
		content: '▸';
		color: var(--muted);
		transition: transform 0.15s;
	}

	details[open] > summary::before {
		transform: rotate(90deg);
	}

	summary h2 {
		margin: 0;
		flex: 1;
	}

	.group-actions {
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}

	.status {
		font-family: var(--font-body);
		font-size: 0.85rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0.75rem 0 0.25rem;
	}

	.status.ordered {
		color: var(--ordered);
	}

	.status.received {
		color: var(--received);
	}

	.lines {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.line {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-top: 1px solid var(--border);
	}

	.lines .line:first-child {
		border-top: none;
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

	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		column-gap: 0.5rem;
		justify-content: flex-start;
		text-align: left;
		background: none;
		border: none;
		padding: 0.6rem 0.25rem;
		font-weight: 400;
		min-height: var(--tap);
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

	.actions {
		margin-top: 0.75rem;
	}

	.wrap {
		flex-wrap: wrap;
	}

	.fewer {
		margin-top: 0.75rem;
	}

	.fewer label {
		margin: 0;
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
