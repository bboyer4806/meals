<script lang="ts">
	import { tick } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import CopyDinner from '#lib/components/CopyDinner.svelte';
	import DinnerDetails from '#lib/components/DinnerDetails.svelte';
	import DinnerDishes from '#lib/components/DinnerDishes.svelte';
	import MoveDinner from '#lib/components/MoveDinner.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import { formatDateLabel } from '#lib/dates.ts';
	import {
		DINNER_TYPES,
		DINNER_TYPE_LABELS,
		hasDishes,
		weekStart,
		type DinnerType
	} from '#lib/menu.ts';
	import { MAX_SERVINGS } from '#lib/recipe-view.ts';

	let { data, form } = $props();

	const dinner = $derived(data.dinner);
	const dishCount = $derived(dinner?.dishes.length ?? 0);

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
	let details = $state<ReturnType<typeof DinnerDetails>>();

	// A failure whose part of the page went with the reload after it, such as adding a dish
	// just as someone switched the dinner to Eating out. It shows here, for this date, until the
	// next change.
	let notice = $state<{ date: string; message: string } | null>(null);
	let noticeElement = $state<HTMLElement>();
	const problem = $derived(
		notice?.date === data.date
			? notice.message
			: form && 'error' in form && form.error
				? form.error
				: null
	);

	async function showNotice(message: string) {
		notice = { date: data.date, message };
		await tick();
		noticeElement?.focus();
	}

	/** "Tuesday, Oct 7", with the year when it isn't this year's. */
	function dayHeading(date: string, today: string): string {
		return new Intl.DateTimeFormat('en-US', {
			timeZone: 'UTC',
			weekday: 'long',
			month: 'short',
			day: 'numeric',
			year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric'
		}).format(new Date(`${date}T00:00:00Z`));
	}

	/** "Oct 4": the Sunday that starts the week (Q27b). */
	function weekLabel(date: string): string {
		return new Intl.DateTimeFormat('en-US', {
			timeZone: 'UTC',
			month: 'short',
			day: 'numeric'
		}).format(new Date(`${weekStart(date)}T00:00:00Z`));
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
					// Shows any dishes someone added, so the next tap asks.
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

	// Clearing removes the actions it was among, so focus goes to the date's new state.
	let unplanned = $state<HTMLElement>();
	const submitClear: SubmitFunction = () => {
		return async ({ result, update }) => {
			await update({ reset: false });
			if (result.type !== 'success') return;
			await tick();
			unplanned?.focus();
		};
	};
</script>

<svelte:head>
	<title>{formatDateLabel(data.date)} · Meals</title>
</svelte:head>

<!-- Any form sent, as the person goes on, takes the last failure's notice away. -->
<svelte:document onsubmit={() => (notice = null)} />

<!-- Rebuilt for each date, so nothing typed for one date shows up on another. -->
{#key data.date}
	<a class="link-tap week" href="/menu?week={weekStart(data.date)}">‹ Week of {weekLabel(data.date)}</a>

	<div class="title">
		<h1>{dayHeading(data.date, data.today)}</h1>
		{#if data.date === data.today}<span class="badge today">Today</span>{/if}
	</div>

	{#if problem}
		<p class="error notice" role="alert" tabindex="-1" bind:this={noticeElement}>{problem}</p>
	{/if}

	{#if !dinner}
		<p class="muted unplanned" tabindex="-1" bind:this={unplanned}>
			Not planned yet. Pick a type, add a dish or copy a dinner.
		</p>
	{/if}

	<form
		class="types"
		method="POST"
		action="?/type"
		use:enhance={submitType}
		aria-label="Type"
		bind:this={typesForm}
	>
		{#each DINNER_TYPES as type (type)}
			<button
				name="type"
				value={type}
				aria-pressed={dinner?.type === type}
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

	{#if !dinner || hasDishes(dinner.type)}
		<DinnerDishes
			{dinner}
			suggestions={data.dishes}
			servings={linkServings}
			onlost={showNotice}
		/>
	{/if}

	{#if dinner}
		<DinnerDetails {dinner} bind:servings={shownServings} bind:this={details} />
	{/if}

	<div class="actions">
		<CopyDinner groups={data.copyGroups} {dishCount} today={data.today} />
		{#if dinner}
			<MoveDinner
				date={data.date}
				canLeave={() => details?.confirmLeave() ?? true}
				onlost={showNotice}
			/>
		{/if}
	</div>

	{#if dinner}
		<form class="clear" method="POST" action="?/clear" use:enhance={submitClear}>
			<ConfirmButton
				label="Clear"
				message="Clear this dinner? The date goes back to not planned. Its dishes stay in your recipes."
				confirmLabel="Clear"
				danger
			/>
		</form>
	{/if}

	<Sheet bind:open={switchOpen} title="Switch to {DINNER_TYPE_LABELS[switchTo]}?">
		<p>
			{DINNER_TYPE_LABELS[switchTo]} has no dishes, so this takes
			{listNames(dinner?.dishes.map((dish) => dish.name) ?? [])} off this dinner. They stay in your
			recipes.
		</p>
		<form method="POST" action="?/type" use:enhance={submitType}>
			<input type="hidden" name="type" value={switchTo} />
			<input type="hidden" name="removeDishes" value="1" />
			<div class="row">
				<button class="primary">Switch to {DINNER_TYPE_LABELS[switchTo]}</button>
				<button type="button" onclick={() => (switchOpen = false)}>Cancel</button>
			</div>
		</form>
	</Sheet>
{/key}

<style>
	.week {
		font-weight: 700;
	}

	.title {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.title h1 {
		margin: 0;
	}

	.today {
		color: var(--accent);
	}

	/* It can name a dish, and a long name without spaces still wraps. */
	.notice {
		overflow-wrap: anywhere;
	}

	.unplanned {
		margin-bottom: 0.5rem;
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
