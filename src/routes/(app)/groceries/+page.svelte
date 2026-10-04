<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import ItemInput from '#lib/components/ItemInput.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import { foldCase, formatQuantity, normalizeName } from '#lib/text.ts';

	let { data, form } = $props();

	type Line = (typeof data.groups)[number]['toOrder'][number];
	type Failure = { error?: string } | undefined;

	const activeStores = $derived(data.stores.filter((store) => store.archivedAt === null));

	function amount(line: { quantity: number; unit: string | null }) {
		return line.unit ? `${formatQuantity(line.quantity)} ${line.unit}` : formatQuantity(line.quantity);
	}

	function failureMessage(data: unknown) {
		return (data as Failure)?.error ?? 'Something went wrong. Please try again.';
	}

	// Add bar

	type AddFields = { itemName: string; quantity: number | null; unit: string; store: string };

	let itemName = $state('');
	// A number input bound with bind:value holds a number, or null while it's empty.
	let quantity = $state<number | null>(1);
	let unit = $state('');
	let store = $state('usual');
	let itemInput: HTMLElement;

	// When the name matches an item, fill in the unit used last time and its store (design 6.4,
	// Q18), but never over something the person changed since the last automatic fill.
	const matched = $derived.by(() => {
		const key = foldCase(normalizeName(itemName));
		return data.items.find((item) => foldCase(item.name) === key);
	});
	let filledUnit = '';
	let filledStore = 'usual';
	$effect(() => {
		const item = matched;
		untrack(() => {
			const nextUnit = item?.lastUnit ?? '';
			const nextStore = item?.defaultStoreId == null ? 'usual' : String(item.defaultStoreId);
			if (unit === filledUnit) unit = nextUnit;
			if (store === filledStore) store = nextStore;
			filledUnit = nextUnit;
			filledStore = nextStore;
		});
	});

	/**
	 * Clears the fields that still hold what was sent; someone may have started the next item.
	 * A unit or store filled in for that next item is left to the effect above.
	 */
	function clearIfUnchanged(sent: AddFields) {
		if (itemName === sent.itemName) itemName = '';
		if (quantity === sent.quantity) quantity = 1;
		if (unit === sent.unit && unit !== filledUnit) unit = '';
		if (store === sent.store && store !== filledStore) store = 'usual';
		itemInput.querySelector('input')?.focus();
	}

	type Prompt = Extract<NonNullable<typeof form>, { prompt: unknown }>['prompt'];

	function promptIn(data: unknown): Prompt | undefined {
		return (data as { prompt?: Prompt } | undefined)?.prompt;
	}

	let prompt = $state<Prompt | null>(null);
	let promptOpen = $state(false);
	// Rebuilt for every question, so an answer abandoned last time doesn't come back.
	let promptKey = $state(0);
	let promptError = $state('');
	// What the add bar held when the prompt's question was first asked.
	let promptSent: AddFields | null = null;

	function ask(question: Prompt) {
		prompt = question;
		promptKey += 1;
		promptError = '';
		promptOpen = true;
	}

	const submitAdd: SubmitFunction = () => {
		const sent = { itemName, quantity, unit, store };
		return async ({ result, update }) => {
			await update({ reset: false });
			const asked = result.type === 'success' ? promptIn(result.data) : undefined;
			if (asked) {
				promptSent = sent;
				ask(asked);
			} else if (result.type === 'success') {
				clearIfUnchanged(sent);
			}
		};
	};

	// The prompt's own forms: errors show in the prompt, and success clears the add bar only
	// where it still holds the item the prompt was about.
	const submitPrompt: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'failure') {
				promptError = failureMessage(result.data);
				return;
			}
			await update({ reset: false });
			const next = result.type === 'success' ? promptIn(result.data) : undefined;
			if (next) {
				// Restoring an archived item can lead straight to the duplicate question.
				ask(next);
			} else if (result.type === 'success') {
				promptOpen = false;
				if (promptSent) clearIfUnchanged(promptSent);
			}
		};
	};

	// One line's actions. Their errors show next to the line or in its sheet, not elsewhere.

	type Where = number | 'sheet' | 'picker';
	let lineError = $state<{ where: Where; message: string } | null>(null);

	function lineFailure(result: ActionResult): string | null {
		if (result.type === 'failure') return failureMessage(result.data);
		// Someone else deleted the line.
		if (result.type === 'error' && result.status === 404) return 'This line is no longer on the list.';
		return null;
	}

	function lineSubmit(where: Where): SubmitFunction {
		return () => {
			return async ({ result, update }) => {
				const message = lineFailure(result);
				if (message !== null) {
					lineError = { where, message };
					// Someone else may have changed the line; show the list as it is now.
					await refreshAll();
					return;
				}
				lineError = null;
				await update({ reset: false });
				if (result.type === 'success') {
					editOpen = false;
					pickOpen = false;
				}
			};
		};
	}

	let editing = $state<Line | null>(null);
	let editOpen = $state(false);
	// Rebuilt every time the sheet opens, so edits abandoned last time don't come back.
	let editKey = $state(0);
	let showFewer = $state(false);
	let fewerSave = $state<HTMLButtonElement>();
	let picking = $state<Line | null>(null);
	let pickOpen = $state(false);

	function edit(line: Line) {
		editing = line;
		editKey += 1;
		showFewer = false;
		lineError = null;
		editOpen = true;
	}

	function pickStore(line: Line) {
		picking = line;
		lineError = null;
		pickOpen = true;
	}

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
</script>

<svelte:head>
	<title>Groceries · Meals</title>
</svelte:head>

<div class="title row">
	<h1 class="grow">Groceries</h1>
	<a class="link-tap" href="/groceries/items">Items</a>
	<a class="link-tap" href="/groceries/history">History</a>
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

{#if (form?.action === 'group' || form?.action === 'line') && form.error}
	<p class="error" role="alert">{form.error}</p>
{/if}

{#if data.groups.length === 0}
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
			<form method="POST" action="?/undoReceive" use:enhance={lineSubmit(line.id)}>
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
			<form method="POST" action="?/receive" use:enhance={lineSubmit(line.id)}>
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
		{#if lineError?.where === line.id}
			<p class="error line-error" role="alert">{lineError.message}</p>
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
	{#if promptError}<p class="error" role="alert">{promptError}</p>{/if}
	{#key promptKey}
		{#if prompt?.kind === 'duplicate' && prompt.status === 'to_order'}
			<p>
				Already on the list: {amount(prompt)}{prompt.storeName ? ` at ${prompt.storeName}` : ''}.
			</p>
			<form method="POST" action="?/add" use:enhance={submitPrompt}>
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
			<form method="POST" action="?/add" use:enhance={submitPrompt}>
				{@render askedFields(prompt.asked, 'add')}
				<div class="row actions">
					<button class="primary">Add {amount(prompt.asked)} more to order</button>
					<button type="button" onclick={() => (promptOpen = false)}>Cancel</button>
				</div>
			</form>
		{:else if prompt?.kind === 'archived'}
			<p>{prompt.itemName} is archived. Restore it and add it to the list?</p>
			<form method="POST" action="?/add" use:enhance={submitPrompt}>
				{@render askedFields(prompt.asked, 'restore')}
				<div class="row actions">
					<button class="primary">Restore and add</button>
					<button type="button" onclick={() => (promptOpen = false)}>Cancel</button>
				</div>
			</form>
		{/if}
	{/key}
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
		{#if lineError?.where === 'picker'}<p class="error" role="alert">{lineError.message}</p>{/if}
		{#if activeStores.length === 0}
			<p>Add your stores on the <a class="link-tap" href="/household">Household</a> page first.</p>
		{:else}
			<form method="POST" action="?/receive" use:enhance={lineSubmit('picker')} class="stores">
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
			<form method="POST" action="?/update" use:enhance={lineSubmit('sheet')}>
				{#if lineError?.where === 'sheet'}<p class="error" role="alert">{lineError.message}</p>{/if}
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
							onkeydown={(event) => {
								// Enter would otherwise press the sheet's first button, Save.
								if (event.key === 'Enter') {
									event.preventDefault();
									event.currentTarget.form?.requestSubmit(fewerSave);
								}
							}}
						/>
						<button formaction="?/gotFewer" bind:this={fewerSave}>Save</button>
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
		flex-wrap: wrap;
		align-items: center;
		gap: 0.25rem;
		border-top: 1px solid var(--border);
	}

	.lines .line:first-child {
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
