<script lang="ts">
	import { tick } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { DISH_ROLES, DISH_ROLE_LABELS, type DishRole } from '../menu.ts';
	import type { Dinner } from '../server/data/dinners.ts';
	import ItemInput from './ItemInput.svelte';
	import Sheet from './Sheet.svelte';

	// A dinner's dishes (design 7, Dinner; 6.9). Each links to its recipe at the dinner's servings
	// and has its role and Remove. A dish is added by name, an existing one or a new one, with a
	// role: Main for the first, Side after. Adding one to a date with no dinner plans it as
	// Cooking at home. The forms post to the dinner page's actions.
	let {
		dinner,
		suggestions
	}: {
		dinner: Dinner | null;
		/** Active dishes, most used first. */
		suggestions: { id: number; name: string; timesAdded: number }[];
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

	/** Sends the change, then shows the dinner as it is now, even when it didn't go through. */
	async function finishRow(dishId: number, result: ActionResult, update: () => Promise<void>) {
		try {
			const message = failureIn(result, GONE);
			if (message !== null) {
				rowError = { dishId, message };
				await refreshAll();
			} else {
				rowError = null;
				await update();
			}
		} finally {
			busy.delete(dishId);
		}
		await tick();
	}

	function roleSubmit(dishId: number): SubmitFunction {
		return ({ cancel, formElement }) => {
			if (busy.has(dishId)) return cancel();
			busy.add(dishId);
			const select = formElement.querySelector('select');
			const hadFocus = select !== null && select === document.activeElement;
			return async ({ result, update }) => {
				await finishRow(dishId, result, () => update({ reset: false }));
				const dish = dishes.find((candidate) => candidate.dishId === dishId);
				if (!select || !dish) return;
				// The saved role, also when the change didn't go through.
				select.value = dish.role;
				// The list is in role order, and moving the row can drop focus.
				if (hadFocus) select.focus();
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
				await finishRow(dishId, result, () => update({ reset: false }));
				if (!hadFocus) return;
				// The dish's own button when it's still here; otherwise the one now in its place,
				// the one before, or the dish field.
				const still = dishes.find((dish) => dish.dishId === dishId);
				const next = still ?? dishes[Math.min(index, dishes.length - 1)];
				const target = next ? document.getElementById(removeId(next.dishId)) : nameInput();
				target?.focus();
			};
		};
	}

	// Adding a dish

	let name = $state('');
	// Main for the first dish and Side after (6.9), until the person picks another.
	let role = $derived<DishRole>(dishes.length === 0 ? 'main' : 'side');
	let adding = $state(false);
	let addError = $state('');
	let nameField: HTMLElement;

	function nameInput(): HTMLInputElement | null {
		return nameField.querySelector('input');
	}

	/** Clears the field if it still holds what was added; someone may have started the next one. */
	function addedName(sent: string) {
		if (name === sent) name = '';
		nameInput()?.focus();
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
					await refreshAll();
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
				if (result.type === 'success') addedName(sent);
			} finally {
				adding = false;
			}
		};
	};

	const submitRestore: SubmitFunction = ({ cancel }) => {
		if (restoring) return cancel();
		restoring = true;
		restoreError = '';
		return async ({ result, update }) => {
			try {
				const message = failureIn(result, 'That dish is no longer in your recipes.');
				if (message !== null) {
					restoreError = message;
					await refreshAll();
					return;
				}
				await update({ reset: false });
				if (result.type === 'success') {
					restoreOpen = false;
					// Once the sheet has closed and given focus back.
					await tick();
					addedName(restoreSent);
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
						<a class="link-tap" href="/recipes/{dish.dishId}?servings={dinner?.servings}">
							{dish.name}
						</a>
						{#if dish.archived}<span class="badge">Archived</span>{/if}
					</span>
					<form method="POST" action="?/role" use:enhance={roleSubmit(dish.dishId)}>
						<input type="hidden" name="dishId" value={dish.dishId} />
						<label class="visually-hidden" for="{uid}-role-{dish.dishId}">
							Role for {dish.name}
						</label>
						<select
							id="{uid}-role-{dish.dishId}"
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
		overflow-wrap: anywhere;
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
