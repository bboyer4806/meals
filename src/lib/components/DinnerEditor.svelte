<script module lang="ts">
	import type { Dinner } from '../server/data/dinners.ts';
	import type { TypedFields } from './DinnerDetails.svelte';

	/**
	 * What a dinner's forms are for: a saved dinner, the unsaved Cooking at home a date with no
	 * dinner shows (no id), or a dinner someone cleared while something typed for it isn't saved
	 * (6.11, MEA-256).
	 */
	export type Editing = Pick<Dinner, 'label' | 'type' | 'restaurantName' | 'note' | 'servings'> & {
		id: number | null;
	};

	/**
	 * What's typed in a dinner's forms and not saved: the details, as typed, and a name in the dish
	 * field not added (MEA-202, MEA-240).
	 */
	export type Typing = { fields: TypedFields; dishName: string | null };
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { DINNER_TYPES, DINNER_TYPE_LABELS, NO_DISHES, hasDishes, type DinnerType } from '../menu.ts';
	import { MAX_SERVINGS } from '../recipe-view.ts';
	import type { CopyGroup } from '../server/data/dinners.ts';
	import ConfirmButton from './ConfirmButton.svelte';
	import CopyDinner from './CopyDinner.svelte';
	import DinnerDetails from './DinnerDetails.svelte';
	import DinnerDishes, { notAdded } from './DinnerDishes.svelte';
	import Sheet from './Sheet.svelte';

	// One dinner on a date's page (design 7, Dinner; 6.9): its type, dishes, servings or
	// restaurant, and note, Copy a dinner and Clear. Each of a date's dinners has its own, and a
	// change to one never changes another. Its forms send the dinner's id, so they act on this
	// dinner only.
	let {
		dinner,
		editing,
		labeled,
		suggestions,
		copyGroups,
		today,
		onlost,
		send,
		oncleared
	}: {
		/** The dinner as it is now, or null on a date with no dinner. */
		dinner: Dinner | null;
		/** What the details form is for. */
		editing: Editing;
		/** Whether the date has more than one dinner, so each has a label (6.9). */
		labeled: boolean;
		suggestions: { id: number; name: string; timesAdded: number }[];
		copyGroups: CopyGroup[];
		today: string;
		/** Shows a failure on the page, once the part of this dinner it belonged to is gone. */
		onlost: (message: string) => void;
		/** Sends one of the page's own changes, so the reload after it keeps what's typed. */
		send: (submit: SubmitFunction) => SubmitFunction;
		/** After this dinner is cleared. */
		oncleared: () => void;
	} = $props();

	const uid = $props.id();
	const dishCount = $derived(dinner?.dishes.length ?? 0);
	let heading = $state<HTMLElement>();
	let details = $state<ReturnType<typeof DinnerDetails>>();
	let dishEditor = $state<ReturnType<typeof DinnerDishes>>();

	// The servings field's value, saved or not, so a dish opens at what the person sees (design 7).
	// One that can't be saved opens it at the saved servings.
	let shownServings = $state<number | null>(null);
	const linkServings = $derived(
		shownServings !== null &&
			Number.isInteger(shownServings) &&
			shownServings >= 1 &&
			shownServings <= MAX_SERVINGS
			? shownServings
			: dinner?.servings
	);

	// Copying the group whose latest dinner is this one would change nothing, so it's left out.
	const groups = $derived(copyGroups.filter((group) => group.dinnerId !== dinner?.id));

	/** Whether there's a dish section: no dinner yet, or one of a type with dishes. */
	function withDishes(shown: Dinner | null): boolean {
		return shown === null || hasDishes(shown.type);
	}

	export function focus(): void {
		heading?.focus();
	}

	/** Whether something typed in the servings, note or label would be lost. */
	export function hasUnsaved(): boolean {
		return details?.hasUnsaved() ?? false;
	}

	/** Whether what's typed here is what another dinner already has saved. */
	export function matches(other: Dinner): boolean {
		return details?.matches(other) ?? false;
	}

	/** What the page says when the dish field goes with a name still in it, or null. */
	export function nameLost(): string | null {
		return dishEditor?.nameLost() ?? null;
	}

	/**
	 * What's typed here and not saved, or null when there's nothing, which the date's page keeps
	 * for when it loads again (design 7, Dinner; MEA-202, MEA-240, MEA-256).
	 */
	export function typing(): Typing | null {
		const fields = details?.typedFields() ?? {};
		const dishName = dishEditor?.keptName() ?? null;
		return Object.keys(fields).length === 0 && dishName === null ? null : { fields, dishName };
	}

	/**
	 * Puts back what was typed and not saved. A dish name comes back while the dinner's type has
	 * dishes; otherwise this returns what the page says about it, so it can be copied, or null.
	 */
	export function restore({ fields, dishName }: Typing): string | null {
		details?.restoreTyped(fields);
		if (dishName === null) return null;
		if (!dishEditor) return notAdded(dishName, NO_DISHES);
		dishEditor.putBackName(dishName);
		return null;
	}

	/** Empties the dish field, when the name in it goes with the dinner it was typed for. */
	export function dropName(): void {
		dishEditor?.dropName();
	}

	/**
	 * Asks before something drops what's typed here, a dish name not added included. True when
	 * nothing is lost or it's agreed.
	 */
	export function confirmLeave(): boolean {
		return details?.confirmLeave() ?? true;
	}

	/** Takes back confirmLeave's agreement when what it was for didn't happen. */
	export function keepAsking(): void {
		details?.keepAsking();
	}

	/** Shows the saved dinner again in the details form, dropping what was typed. */
	export function reset(): void {
		details?.reset();
	}

	/** Adds a request's note to the end of a note typed here and not saved (6.12). */
	export function addNote(added: string): void {
		details?.addNote(added);
	}

	/** "Tacos", "Tacos and Rice", "Tacos, Rice and Salad". */
	function listNames(names: string[]): string {
		if (names.length <= 1) return names.join('');
		return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
	}

	// The type. Eating out and Leftovers have no dishes, so switching to them asks first when
	// there are some (2.3).

	let typeError = $state('');
	let typeBusy = $state(false);
	let switchTo = $state<DinnerType>('eat_out');
	let switchOpen = $state(false);
	let typesForm = $state<HTMLFormElement>();

	function askSwitch(type: DinnerType) {
		switchTo = type;
		typeError = '';
		switchOpen = true;
	}

	const submitType: SubmitFunction = ({ cancel, formData, formElement }) => {
		const type = formData.get('type');
		if (typeBusy || type === dinner?.type) return cancel();
		typeBusy = true;
		typeError = '';
		const hadFocus = formElement.contains(document.activeElement);
		return async ({ result, update }) => {
			try {
				switchOpen = false;
				if (result.type === 'failure') {
					typeError =
						(result.data as { error?: string } | undefined)?.error ??
						'Something went wrong. Please try again.';
					// Shows any dishes someone added, so the next tap asks, or the dinner someone
					// put on this date.
					await refreshAll();
				} else {
					await update({ reset: false });
				}
			} finally {
				typeBusy = false;
			}
			// SvelteKit moves focus to the top of the page after a form succeeds, and the sheet
			// closes, so the type that was picked takes it back.
			if (!hadFocus) return;
			await tick();
			typesForm?.querySelector<HTMLButtonElement>(`button[value="${type}"]`)?.focus();
		};
	};

	// Clearing removes the actions it was among, so the page moves focus. The form drops what was
	// typed for the cleared dinner.
	const submitClear: SubmitFunction = () => {
		return async ({ result, update }) => {
			// When someone put another dinner on this date meanwhile, it isn't cleared, and the
			// page shows it under the message.
			await update({ reset: false, refreshAll: true });
			if (result.type !== 'success') return;
			await tick();
			details?.reset();
			oncleared();
		};
	};
</script>

<!-- Which dinner this is, so a change meant for it isn't made to another one. -->
{#snippet shownDinner()}
	{#if dinner}<input type="hidden" name="dinnerId" value={dinner.id} />{/if}
{/snippet}

<!-- Any form sent, as the person goes on, takes the last failure's message away. -->
<svelte:document onsubmit={() => (typeError = '')} />

<section class="dinner" class:labeled aria-labelledby={labeled ? `${uid}-heading` : undefined}>
	{#if labeled}
		<h2 id="{uid}-heading" class="label" tabindex="-1" bind:this={heading}>{dinner?.label}</h2>
	{/if}

	<form
		class="types"
		method="POST"
		action="?/type"
		use:enhance={send(submitType)}
		aria-label="Type"
		bind:this={typesForm}
	>
		{@render shownDinner()}
		{#each DINNER_TYPES as type (type)}
			<button
				name="type"
				value={type}
				aria-pressed={editing.type === type}
				onclick={(event) => {
					if (dishCount > 0 && !hasDishes(type)) {
						event.preventDefault();
						askSwitch(type);
					}
				}}>{DINNER_TYPE_LABELS[type]}</button
			>
		{/each}
	</form>
	{#if typeError}<p class="error" role="alert">{typeError}</p>{/if}

	{#if withDishes(dinner)}
		<DinnerDishes
			{dinner}
			{suggestions}
			servings={linkServings}
			{onlost}
			{send}
			bind:this={dishEditor}
		/>
	{/if}

	<DinnerDetails
		dinner={editing}
		{labeled}
		typedDish={dishEditor?.typedName() ?? ''}
		{send}
		bind:servings={shownServings}
		bind:this={details}
	/>

	<div class="actions">
		<CopyDinner {groups} dinnerId={dinner?.id} {dishCount} {today} {send} />
	</div>

	{#if dinner}
		<form class="clear" method="POST" action="?/clear" use:enhance={send(submitClear)}>
			{@render shownDinner()}
			<ConfirmButton
				label="Clear"
				message={labeled
					? 'Clear this dinner? Its dishes stay in your recipes.'
					: 'Clear this dinner? The date goes back to not planned. Its dishes stay in your recipes.'}
				confirmLabel="Clear"
				danger
			/>
		</form>
	{/if}
</section>

<Sheet bind:open={switchOpen} title="Switch to {DINNER_TYPE_LABELS[switchTo]}?">
	<p>
		{DINNER_TYPE_LABELS[switchTo]} has no dishes, so this takes
		{listNames(dinner?.dishes.map((dish) => dish.name) ?? [])} off this dinner. They stay in your
		recipes.
	</p>
	<form method="POST" action="?/type" use:enhance={send(submitType)}>
		{@render shownDinner()}
		<input type="hidden" name="type" value={switchTo} />
		<input type="hidden" name="removeDishes" value="1" />
		<div class="row">
			<button class="primary">Switch to {DINNER_TYPE_LABELS[switchTo]}</button>
			<button type="button" onclick={() => (switchOpen = false)}>Cancel</button>
		</div>
	</form>
</Sheet>

<style>
	/* A long label without spaces still wraps. */
	.label {
		margin: 0 0 0.5rem;
		overflow-wrap: anywhere;
	}

	/* Each of a date's dinners is set apart from the next. Each dinner's switch sheet comes after
	   its section, so the next dinner is a later sibling, not the adjacent one. */
	.labeled ~ :global(.dinner.labeled) {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 2px solid var(--border);
	}

	/* Two by two on a phone, one row on a wider screen. */
	.types {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.types button {
		padding-inline: 0.5rem;
	}

	/* Filled in, not only colored, so the current type doesn't rely on color alone. */
	.types button[aria-pressed='true'] {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}

	.actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.5rem;
	}

	.clear {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}
</style>
