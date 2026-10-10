<script lang="ts">
	import { onDestroy, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { DISH_ROLES, DISH_ROLE_LABELS, type DishRole } from '../menu.ts';
	import type { Dinner } from '../server/data/dinners.ts';
	import { normalizeName } from '../text.ts';
	import ItemInput from './ItemInput.svelte';
	import Sheet from './Sheet.svelte';

	// A dinner's dishes (design 7, Dinner; 6.9). Each links to its recipe at the dinner's servings
	// and has its role and Remove. A dish is added by name, an existing one or a new one, with a
	// role: Main for the first, Side after. Adding one to a date with no dinner plans it as
	// Cooking at home. The forms post to the dinner page's actions.
	let {
		dinner,
		suggestions,
		servings,
		onlost
	}: {
		dinner: Dinner | null;
		/** Active dishes, most used first. */
		suggestions: { id: number; name: string; timesAdded: number }[];
		/** The servings on screen, saved or not, which each recipe opens at. */
		servings: number | undefined;
		/**
		 * Shows a failure on the page instead, when the reload after it took these dishes off the
		 * page (someone switched the dinner to a type without dishes meanwhile).
		 */
		onlost: (message: string) => void;
	} = $props();

	type Failure = { error?: string } | undefined;
	type Archived = { dishId: number; name: string; role: DishRole };

	const uid = $props.id();
	const dishes = $derived(dinner?.dishes ?? []);

	function failureIn(result: ActionResult, gone: string): string | null {
		if (result.type === 'failure') {
			return (result.data as Failure)?.error ?? 'Something went wrong. Please try again.';
		}
		// Someone else took the dish off, or cleared or moved the dinner.
		if (result.type === 'error' && result.status === 404) return gone;
		return null;
	}

	// Set once these dishes are off the page.
	let removed = false;
	onDestroy(() => (removed = true));

	/**
	 * After a failure, shows the dinner as it is now. When that takes these dishes off the page,
	 * the message would go with them, so the page shows it. True while they're still here.
	 */
	async function reload(message: string): Promise<boolean> {
		await refreshAll();
		await tick();
		if (removed) onlost(message);
		return !removed;
	}

	function roleId(dishId: number) {
		return `${uid}-role-${dishId}`;
	}

	function removeId(dishId: number) {
		return `${uid}-remove-${dishId}`;
	}

	// A dish's role and Remove. Their errors show on the dish, or above the list if it's gone.

	const GONE = 'That dish is no longer on this dinner.';
	let rowError = $state<{ dishId: number; message: string } | null>(null);
	// Dishes with a request on its way, so a double tap doesn't send a second one.
	const busy = new SvelteSet<number>();

	const lostError = $derived(
		rowError !== null && !dishes.some((dish) => dish.dishId === rowError?.dishId)
			? rowError.message
			: null
	);

	/**
	 * Sends the change, then shows the dinner as it is now, even when it didn't go through. True
	 * while the dishes are still on the page.
	 */
	async function finishRow(
		dishId: number,
		result: ActionResult,
		update: () => Promise<void>
	): Promise<boolean> {
		try {
			const message = failureIn(result, GONE);
			if (message !== null) {
				rowError = { dishId, message };
				return await reload(message);
			}
			rowError = null;
			await update();
		} finally {
			busy.delete(dishId);
		}
		await tick();
		return true;
	}

	/**
	 * Gives focus back to a dish's role or Remove after a change to it. When someone else took
	 * the dish off meanwhile, the dish now in its place takes it, or the one before, or the dish
	 * field.
	 */
	function focusRow(dishId: number, index: number, control: 'role' | 'remove') {
		const still = dishes.find((dish) => dish.dishId === dishId);
		const next = still ?? dishes[Math.min(index, dishes.length - 1)];
		const id = next && (control === 'role' ? roleId(next.dishId) : removeId(next.dishId));
		const target = id ? document.getElementById(id) : nameInput();
		target?.focus();
	}

	function roleSubmit(dishId: number): SubmitFunction {
		return ({ cancel, formElement }) => {
			if (busy.has(dishId)) return cancel();
			busy.add(dishId);
			const select = formElement.querySelector('select');
			const hadFocus = select !== null && select === document.activeElement;
			const index = dishes.findIndex((dish) => dish.dishId === dishId);
			return async ({ result, update }) => {
				if (!(await finishRow(dishId, result, () => update({ reset: false })))) return;
				const dish = dishes.find((candidate) => candidate.dishId === dishId);
				// The saved role, also when the change didn't go through.
				if (select && dish) select.value = dish.role;
				// The list is in role order, and moving the row can drop focus.
				if (hadFocus) focusRow(dishId, index, 'role');
			};
		};
	}

	function removeSubmit(dishId: number): SubmitFunction {
		return ({ cancel, formElement }) => {
			if (busy.has(dishId)) return cancel();
			busy.add(dishId);
			const hadFocus = formElement.contains(document.activeElement);
			const index = dishes.findIndex((dish) => dish.dishId === dishId);
			return async ({ result, update }) => {
				if (!(await finishRow(dishId, result, () => update({ reset: false })))) return;
				if (hadFocus) focusRow(dishId, index, 'remove');
			};
		};
	}

	// Adding a dish

	let name = $state('');
	// Main for the first dish and Side after (6.9). The person's pick stays, also when the page
	// reloads, until a dish is added or the number of dishes changes.
	const defaultRole = (count: number): DishRole => (count === 0 ? 'main' : 'side');
	const dishCount = $derived(dishes.length);
	let role = $state<DishRole>(untrack(() => defaultRole(dishCount)));
	$effect(() => {
		role = defaultRole(dishCount);
	});
	let adding = $state(false);
	let addError = $state('');
	let nameField: HTMLElement;

	function nameInput(): HTMLInputElement | null {
		return nameField.querySelector('input');
	}

	/**
	 * After a dish is added, the next one's role starts over, and the field is cleared if it still
	 * holds what was added; someone may have started the next one.
	 */
	function added(sent: string) {
		role = defaultRole(dishes.length);
		if (name === sent) name = '';
		nameInput()?.focus();
	}

	/** "Garlic bread wasn't added. Switch to ...", shown on the page once the field is gone. */
	function notAdded(dishName: string, message: string): string {
		const named = normalizeName(dishName);
		const reason = /[.!?]$/.test(message) ? message : `${message}.`;
		return named === '' ? reason : `${named} wasn't added. ${reason}`;
	}

	let archived = $state<Archived | null>(null);
	let restoreOpen = $state(false);
	let restoreError = $state('');
	let restoring = $state(false);
	let restoreSent = '';

	function archivedIn(data: unknown): Archived | null {
		return (data as { archived?: Archived | null } | undefined)?.archived ?? null;
	}

	const submitAdd: SubmitFunction = ({ cancel }) => {
		if (adding) return cancel();
		adding = true;
		addError = '';
		const sent = name;
		return async ({ result, update }) => {
			try {
				const message = failureIn(result, GONE);
				if (message !== null) {
					addError = message;
					// Someone may have switched the type or added the dish meanwhile.
					await reload(notAdded(sent, message));
					return;
				}
				const offer = result.type === 'success' ? archivedIn(result.data) : null;
				if (offer) {
					// Nothing changed, so there's nothing to reload, and focus stays where it was
					// for when the sheet closes.
					archived = offer;
					restoreSent = sent;
					restoreError = '';
					restoreOpen = true;
					return;
				}
				await update({ reset: false });
				if (result.type === 'success') added(sent);
			} finally {
				adding = false;
			}
		};
	};

	const submitRestore: SubmitFunction = ({ cancel }) => {
		if (restoring) return cancel();
		restoring = true;
		restoreError = '';
		const sentName = archived?.name ?? '';
		return async ({ result, update }) => {
			try {
				const message = failureIn(result, 'That dish is no longer in your recipes.');
				if (message !== null) {
					restoreError = message;
					await reload(notAdded(sentName, message));
					return;
				}
				await update({ reset: false });
				if (result.type === 'success') {
					restoreOpen = false;
					// Once the sheet has closed and given focus back.
					await tick();
					added(restoreSent);
				}
			} finally {
				restoring = false;
			}
		};
	};
</script>

<section class="card" aria-labelledby="{uid}-heading">
	<h2 id="{uid}-heading">Dishes</h2>
	{#if lostError}<p class="error" role="alert">{lostError}</p>{/if}

	{#if dishes.length > 0}
		<ul class="list dishes">
			{#each dishes as dish (dish.dishId)}
				<li class="dish">
					<span class="name">
						<a class="link-tap" href="/recipes/{dish.dishId}?servings={servings}">
							{dish.name}
						</a>
						{#if dish.archived}<span class="badge">Archived</span>{/if}
					</span>
					<form method="POST" action="?/role" use:enhance={roleSubmit(dish.dishId)}>
						<input type="hidden" name="dishId" value={dish.dishId} />
						<label class="visually-hidden" for={roleId(dish.dishId)}>
							Role for {dish.name}
						</label>
						<select
							id={roleId(dish.dishId)}
							name="role"
							value={dish.role}
							onchange={(event) => event.currentTarget.form?.requestSubmit()}
						>
							{#each DISH_ROLES as option (option)}
								<option value={option}>{DISH_ROLE_LABELS[option]}</option>
							{/each}
						</select>
					</form>
					<form method="POST" action="?/removeDish" use:enhance={removeSubmit(dish.dishId)}>
						<input type="hidden" name="dishId" value={dish.dishId} />
						<button id={removeId(dish.dishId)} class="remove" aria-label="Remove {dish.name}">
							✕
						</button>
					</form>
					{#if rowError?.dishId === dish.dishId}
						<p class="error row-error" role="alert">{rowError.message}</p>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">No dishes yet.</p>
	{/if}

	<form class="add" method="POST" action="?/addDish" use:enhance={submitAdd}>
		<label for="{uid}-name">Add a dish</label>
		<div bind:this={nameField}>
			<ItemInput
				id="{uid}-name"
				name="name"
				placeholder="Search or type a new dish"
				items={suggestions}
				bind:value={name}
				noun="dish"
			/>
		</div>
		<div class="row">
			<label class="visually-hidden" for="{uid}-new-role">Role</label>
			<select class="grow" id="{uid}-new-role" name="role" bind:value={role}>
				{#each DISH_ROLES as option (option)}
					<option value={option}>{DISH_ROLE_LABELS[option]}</option>
				{/each}
			</select>
			<button class="primary">Add</button>
		</div>
		{#if addError}<p class="error" role="alert">{addError}</p>{/if}
	</form>
</section>

<Sheet bind:open={restoreOpen} title={archived?.name ?? ''}>
	{#if archived}
		<p>{archived.name} is archived. Restore it and add it to this dinner?</p>
		<form method="POST" action="?/restoreDish" use:enhance={submitRestore}>
			<input type="hidden" name="dishId" value={archived.dishId} />
			<input type="hidden" name="role" value={archived.role} />
			{#if restoreError}<p class="error" role="alert">{restoreError}</p>{/if}
			<div class="row">
				<button class="primary">Restore it and add</button>
				<button type="button" onclick={() => (restoreOpen = false)}>Cancel</button>
			</div>
		</form>
	{/if}
</Sheet>

<style>
	/* A long dish name without spaces wraps, in the list and in messages such as "<name> is
	   already on this dinner", rather than widening the page past the screen. */
	section {
		overflow-wrap: anywhere;
	}

	h2 {
		margin-bottom: 0.25rem;
	}

	.dishes {
		margin-bottom: 0.75rem;
	}

	.dish {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.5rem;
	}

	.list > .dish {
		padding: 0.25rem 0;
	}

	.name {
		flex: 1 1 8rem;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 0.5rem;
		font-weight: 700;
	}

	/* A short name, such as "Pie", is still a full-size tap target. */
	.name a {
		min-width: var(--tap);
	}

	select {
		width: auto;
	}

	.remove {
		width: var(--tap);
		padding: 0;
		border-color: transparent;
		background: none;
		color: var(--accent);
		font-size: 1.15rem;
	}

	.row-error {
		flex-basis: 100%;
		margin: 0;
	}

	.add {
		display: grid;
		gap: 0.5rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border);
	}

	.add label {
		margin: 0;
	}

	.add p {
		margin: 0;
	}
</style>
