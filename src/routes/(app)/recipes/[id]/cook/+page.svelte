<script lang="ts">
	import { page } from '$app/state';
	import IngredientList from '#lib/components/IngredientList.svelte';
	import { servingsLabel, targetServings } from '#lib/recipe-view.ts';
	import { scaleFactor } from '#lib/scaling.ts';
	import { splitSteps, stepHasUnscaledAmount } from '#lib/steps.ts';

	let { data } = $props();

	const dish = $derived(data.dish);
	const servings = $derived(targetServings(page.url.searchParams.get('servings'), dish.servings));
	const factor = $derived(scaleFactor(servings, dish.servings));
	const steps = $derived(splitSteps(dish.steps));
	// Check marks live only in this page; they aren't saved (design 2.3).
	let doneSteps = $state<Record<number, boolean>>({});

	// Keeps the screen on while cooking, with the Screen Wake Lock API. The browser lets go of
	// the lock whenever the page is hidden, so it's asked for again each time the page is shown.
	let screenMayTurnOff = $state(false);

	$effect(() => {
		if (!('wakeLock' in navigator)) {
			screenMayTurnOff = true;
			return;
		}
		let lock: WakeLockSentinel | null = null;
		let asking = false;
		let left = false;

		async function keepOn() {
			if (left || asking || lock !== null || document.visibilityState !== 'visible') return;
			asking = true;
			try {
				const sentinel = await navigator.wakeLock.request('screen');
				if (left) {
					await sentinel.release();
					return;
				}
				lock = sentinel;
				sentinel.addEventListener('release', () => {
					if (lock === sentinel) lock = null;
				});
				screenMayTurnOff = false;
			} catch {
				// Refused, such as in battery saver mode.
				screenMayTurnOff = true;
			} finally {
				asking = false;
			}
		}

		void keepOn();
		document.addEventListener('visibilitychange', keepOn);
		return () => {
			left = true;
			document.removeEventListener('visibilitychange', keepOn);
			void lock?.release();
		};
	});
</script>

<svelte:head>
	<title>Cooking {dish.name} · Meals</title>
</svelte:head>

<div class="cook">
	<a class="link-tap" href="/recipes/{dish.id}?servings={servings}">Back to recipe</a>
	<h1>{dish.name} <span class="for">· {servingsLabel(servings)}</span></h1>
	{#if screenMayTurnOff}
		<p class="muted note">
			The screen may turn off while you cook. This browser couldn't keep it on.
		</p>
	{/if}

	{#if dish.ingredients.length === 0 && steps.length === 0}
		<p>No recipe yet. <a href="/recipes/{dish.id}/edit">Edit</a></p>
	{/if}

	{#if dish.ingredients.length > 0}
		<section>
			<h2>Ingredients</h2>
			<IngredientList ingredients={dish.ingredients} {factor} checkable />
		</section>
	{/if}

	{#if steps.length > 0}
		<section>
			<h2>Steps</h2>
			<ol class="steps">
				{#each steps as step, index (index)}
					<li>
						<label class="check-off" class:done={doneSteps[index]}>
							<input type="checkbox" bind:checked={doneSteps[index]} />
							<span>
								<strong class="number">{index + 1}.</strong>
								{step}
								{#if factor !== 1 && stepHasUnscaledAmount(step)}
									<span class="warning">Amounts in this step aren't scaled.</span>
								{/if}
							</span>
						</label>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	{#if dish.notes}
		<section>
			<h2>Notes</h2>
			<p class="notes">{dish.notes}</p>
		</section>
	{/if}
</div>

<style>
	.cook {
		font-size: 1.2rem;
	}

	h1 {
		font-size: 2rem;
		overflow-wrap: anywhere;
	}

	.for {
		font-family: var(--font-body);
		font-size: 1.1rem;
		font-weight: 700;
		color: var(--muted);
		white-space: nowrap;
	}

	.note {
		font-size: 1rem;
	}

	section {
		margin-top: 1.5rem;
	}

	/* Numbered in the text, since a list marker can't line up with the checkbox. */
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.steps li {
		border-top: 1px solid var(--border);
		overflow-wrap: anywhere;
	}

	.steps li:first-child {
		border-top: none;
	}

	.number {
		color: var(--accent);
	}

	.done .number {
		color: inherit;
	}

	.warning {
		display: block;
		font-size: 1rem;
		font-weight: 600;
		color: var(--ordered);
	}

	.notes {
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
</style>
