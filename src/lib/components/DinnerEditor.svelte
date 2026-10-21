<script lang="ts">
	import { tick } from 'svelte';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { DINNER_TYPES, DINNER_TYPE_LABELS, hasDishes, type DinnerType } from '../menu.ts';
	import { MAX_SERVINGS } from '../recipe-view.ts';
	import type { CopyGroup, Dinner } from '../server/data/dinners.ts';
	import ConfirmButton from './ConfirmButton.svelte';
	import CopyDinner from './CopyDinner.svelte';
	import DinnerDetails from './DinnerDetails.svelte';
	import DinnerDishes from './DinnerDishes.svelte';
	import Sheet from './Sheet.svelte';

	// One dinner on a date's page (design 7, Dinner; 6.9): its type, dishes, servings and note,
	// Copy a dinner and Clear. Each of a date's dinners has its own, and a change to one never
	// changes another. Its forms send the dinner's id, so they act on this dinner only.
	let {
		dinner,
		editing,
		labeled,
		suggestions,
		copyGroups,
		today,
		onlost,
		ownUpdate,
		oncleared
	}: {
		/** The dinner as it is now, or null on a date with no dinner. */
		dinner: Dinner | null;
		/**
		 * What the details form is for: the dinner, the unsaved Cooking at home a date with no
		 * dinner shows, or a dinner someone cleared or moved while something typed here isn't
		 * saved (6.11).
		 */
		editing: Pick<Dinner, 'label' | 'type' | 'note' | 'servings'> & { id: number | null };
		/** Whether the date has more than one dinner, so each has a label (6.9). */
		labeled: boolean;
		suggestions: { id: number; name: string; timesAdded: number }[];
		copyGroups: CopyGroup[];
		today: string;
		/** Shows a failure on the page, once the part of this dinner it belonged to is gone. */
		onlost: (message: string) => void;
		/** Reloads the page after one of its own changes, which keeps what's typed. */
		ownUpdate: (result: ActionResult, update: () => Promise<void>) => Promise<void>;
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

	/** The note as typed, as it would be stored. */
	export function typedNote(): string {
		return details?.typedNote() ?? '';
	}

	/** What the page says when the dish field goes with a name still in it, or null. */
	export function nameLost(): string | null {
		return dishEditor?.nameLost() ?? null;
	}

	/** Asks before something drops what's typed here. True when nothing is lost or it's agreed. */
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
					await ownUpdate(result, () => update({ reset: false }));
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
			await ownUpdate(result, () => update({ reset: false, refreshAll: true }));
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
		use:enhance={submitType}
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
			{ownUpdate}
			bind:this={dishEditor}
		/>
	{/if}

	<DinnerDetails dinner={editing} {labeled} bind:servings={shownServings} bind:this={details} />

	<div class="actions">
		<CopyDinner {groups} dinnerId={dinner?.id} {dishCount} {today} {ownUpdate} />
	</div>

	{#if dinner}
		<form class="clear" method="POST" action="?/clear" use:enhance={submitClear}>
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
	<form method="POST" action="?/type" use:enhance={submitType}>
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

	/* Each of a date's dinners is set apart from the next. */
	.labeled + :global(.dinner.labeled) {
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
