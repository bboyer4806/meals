<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import ConfirmButton from '#lib/components/ConfirmButton.svelte';
	import IngredientList from '#lib/components/IngredientList.svelte';
	import {
		MAX_SERVINGS,
		formatMinutes,
		formatRating,
		nutritionFacts,
		servingsLabel,
		sourceLink,
		targetServings
	} from '#lib/recipe-view.ts';
	import { scaleFactor } from '#lib/scaling.ts';
	import { splitSteps, stepHasUnscaledAmount } from '#lib/steps.ts';

	let { data, form } = $props();

	const dish = $derived(data.dish);
	const steps = $derived(splitSteps(dish.steps));
	// With no ingredients and no steps there's nothing to scale, cook or print yet.
	const hasRecipe = $derived(dish.ingredients.length > 0 || steps.length > 0);
	const facts = $derived(nutritionFacts(dish));
	const link = $derived(dish.source === null ? null : sourceLink(dish.source));

	// The servings come from ?servings= in the address bar, worked out the same way on the server
	// and here. The control changes the address with shallow routing (no reload), which leaves
	// page.url as it was, so after a change the address is page.shallow's. Data reloads still use
	// page.url, which is why the servings aren't part of the page's data.
	const address = $derived(page.shallow?.url ?? page.url);
	// Set straight away on a tap, so quick taps all count before the address catches up.
	let servings = $derived(targetServings(address.searchParams.get('servings'), dish.servings));
	const factor = $derived(scaleFactor(servings, dish.servings));

	let fewerButton = $state<HTMLButtonElement>();
	let moreButton = $state<HTMLButtonElement>();
	let requestedLabel = $state<HTMLElement>();

	function setServings(next: number) {
		servings = next;
		// The button that reached its limit is disabled, which would drop focus to the page.
		if (next <= 1) moreButton?.focus();
		else if (next >= MAX_SERVINGS) fewerButton?.focus();
		const url = new URL(address.href);
		url.searchParams.set('servings', String(next));
		// Replacing the history entry means Back still leaves the recipe in one step.
		void goto(url, { shallow: true, replace: true });
	}
</script>

<svelte:head>
	<title>{dish.name} · Meals</title>
</svelte:head>

<!-- Always the plain list, however the recipe was opened (section 7). -->
<a class="link-tap back no-print" href="/recipes">‹ Recipes</a>

{#if dish.photoKey}
	<img class="photo" src="/photos/{dish.photoKey}.jpg" alt="" />
{/if}

<h1>{dish.name}</h1>

{#if dish.archivedAt !== null}
	<div class="archived no-print">
		<span class="badge">Archived</span>
		<form method="POST" action="?/restore" use:enhance>
			<button>Restore</button>
		</form>
	</div>
{/if}

{#if dish.tags.length > 0}
	<ul class="chips" aria-label="Tags">
		{#each dish.tags as tag (tag)}
			<li><a class="chip" href="/recipes?tag={encodeURIComponent(tag)}">{tag}</a></li>
		{/each}
	</ul>
{/if}

<!-- Saved on tap, with no Save button (section 7, "Recipe"). -->
<form
	class="no-print"
	method="POST"
	action="?/tried"
	use:enhance={() =>
		({ update }) =>
			update({ reset: false })}
>
	<label class="check-off">
		<input
			type="checkbox"
			name="tried"
			checked={dish.tried}
			onchange={(event) => event.currentTarget.form?.requestSubmit()}
		/>
		<span>Tried it</span>
	</label>
	{#if form?.action === 'tried' && form.error}<p class="error" role="alert">{form.error}</p>{/if}
</form>

<!-- Your own stars, saved on tap; the current star again clears them. Beside them, the
household's average, with no names (section 7, "Recipe"). -->
<form
	class="rating no-print"
	method="POST"
	action="?/rate"
	use:enhance={() =>
		({ update }) =>
			update({ reset: false })}
>
	<div class="stars" role="group" aria-label="Your rating">
		{#each [1, 2, 3, 4, 5] as stars (stars)}
			<button
				class="star"
				name="stars"
				value={stars}
				aria-label={stars === 1 ? '1 star' : `${stars} stars`}
				aria-pressed={data.ownRating === stars}
				>{data.ownRating !== null && stars <= data.ownRating ? '★' : '☆'}</button
			>
		{/each}
	</div>
	{#if dish.rating}<span class="average">{formatRating(dish.rating)}</span>{/if}
	{#if form?.action === 'rate' && form.error}<p class="error" role="alert">{form.error}</p>{/if}
</form>

<!-- Asks for the dish on the Menu's Requests, saved on tap. A recipe with any request, from here
or the Menu, says Requested in its place, and an archived one has no Request (6.12; section 7,
"Recipe"). -->
{#if data.requested || dish.archivedAt === null}
	<form
		class="request no-print"
		method="POST"
		action="?/request"
		use:enhance={() =>
			async ({ update }) => {
				// Landing on ?/request would drop ?servings= and show the recipe's own servings.
				await update({ navigate: false });
				// The button is gone, which would drop focus to the page.
				requestedLabel?.focus();
			}}
	>
		{#if data.requested}
			<span class="badge" tabindex="-1" bind:this={requestedLabel}>Requested</span>
		{:else}
			<button>Request</button>
		{/if}
		{#if form?.action === 'request' && form.error}<p class="error" role="alert">{form.error}</p>{/if}
	</form>
{/if}

{#if dish.prepMinutes !== null || dish.cookMinutes !== null}
	<dl class="times">
		{#if dish.prepMinutes !== null}
			<div><dt>Prep</dt><dd>{formatMinutes(dish.prepMinutes)}</dd></div>
		{/if}
		{#if dish.cookMinutes !== null}
			<div><dt>Cook</dt><dd>{formatMinutes(dish.cookMinutes)}</dd></div>
		{/if}
		<!-- With only one of them, the total would just repeat it. -->
		{#if dish.prepMinutes !== null && dish.cookMinutes !== null}
			<div><dt>Total</dt><dd>{formatMinutes(dish.prepMinutes + dish.cookMinutes)}</dd></div>
		{/if}
	</dl>
{/if}

{#if hasRecipe}
	<div class="servings no-print">
		<button
			type="button"
			class="adjust"
			aria-label="Fewer servings"
			bind:this={fewerButton}
			disabled={servings <= 1}
			onclick={() => setServings(servings - 1)}>−</button
		>
		<span class="count" role="status">{servingsLabel(servings)}</span>
		<button
			type="button"
			class="adjust"
			aria-label="More servings"
			bind:this={moreButton}
			disabled={servings >= MAX_SERVINGS}
			onclick={() => setServings(servings + 1)}>+</button
		>
	</div>
	{#if factor !== 1}
		<p class="scaled muted no-print">Scaled from {servingsLabel(dish.servings)}.</p>
	{/if}
	<p class="print-only">Serves {servings}</p>

	<div class="actions no-print">
		<a class="button primary" href="/recipes/{dish.id}/cook?servings={servings}">Cook</a>
		<button type="button" onclick={() => window.print()}>Print</button>
		<a class="button" href="/recipes/{dish.id}/edit">Edit</a>
	</div>

	{#if dish.ingredients.length > 0}
		<section class="card">
			<h2>Ingredients</h2>
			<IngredientList ingredients={dish.ingredients} {factor} />
		</section>
	{/if}

	{#if steps.length > 0}
		<section class="card">
			<h2>Steps</h2>
			<ol class="steps">
				{#each steps as step, index (index)}
					<li>
						{step}
						{#if factor !== 1 && stepHasUnscaledAmount(step)}
							<span class="warning">Amounts in this step aren't scaled.</span>
						{/if}
					</li>
				{/each}
			</ol>
		</section>
	{/if}
{:else}
	<section class="card">
		<p>No recipe yet.</p>
		<a class="button no-print" href="/recipes/{dish.id}/edit">Edit</a>
	</section>
{/if}

{#if dish.notes}
	<section class="card">
		<h2>Notes</h2>
		<p class="notes">{dish.notes}</p>
	</section>
{/if}

{#if dish.source}
	<p class="source">
		Source:
		{#if link}
			<a class="link-tap" href={link} target="_blank" rel="noopener noreferrer">
				{dish.source}
			</a>
		{:else}
			{dish.source}
		{/if}
	</p>
{/if}

{#if facts.length > 0}
	<section class="card">
		<h2>Nutrition per serving</h2>
		<dl class="nutrition">
			{#each facts as fact (fact.label)}
				<div><dt>{fact.label}</dt><dd>{fact.value}</dd></div>
			{/each}
		</dl>
	</section>
{/if}

{#if dish.archivedAt === null}
	<form class="archive no-print" method="POST" action="?/archive" use:enhance>
		<ConfirmButton
			label="Archive"
			message={`Archive ${dish.name}? It leaves the recipe list, and you can restore it ` +
				'from the archived recipes.'}
			confirmLabel="Archive"
		/>
	</form>
{/if}

<style>
	.back {
		font-weight: 700;
	}

	.photo {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: var(--radius);
		margin-bottom: 1rem;
		background: var(--surface-sunk);
	}

	h1 {
		overflow-wrap: anywhere;
	}

	.archived {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}

	.rating {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.75rem;
		margin-bottom: 0.5rem;
	}

	.stars {
		display: flex;
	}

	.star {
		width: var(--tap);
		padding: 0;
		border: none;
		background: none;
		font-size: 1.6rem;
		line-height: 1;
		color: var(--accent);
	}

	.average {
		font-weight: 700;
	}

	/* As tall as the button, so Requested takes its place without moving the page. */
	.request {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.75rem;
		min-height: var(--tap);
		margin-bottom: 0.5rem;
	}

	.times,
	.nutrition {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 1.25rem;
		margin: 0 0 0.75rem;
	}

	.times div,
	.nutrition div {
		display: flex;
		gap: 0.35rem;
	}

	dt {
		color: var(--muted);
	}

	dd {
		margin: 0;
		font-weight: 700;
	}

	.servings {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.5rem 0;
	}

	.adjust {
		width: var(--tap);
		padding: 0;
		border-radius: 50%;
		font-size: 1.4rem;
		line-height: 1;
	}

	.count {
		min-width: 7rem;
		text-align: center;
		font-weight: 700;
	}

	.scaled {
		font-size: 0.9rem;
	}

	/* Two even columns on a phone, one row on a wider screen. */
	.actions {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.5rem;
		margin: 0.75rem 0 1rem;
	}

	.steps {
		margin: 0;
		padding-left: 1.5rem;
	}

	.steps li {
		padding: 0.35rem 0;
		overflow-wrap: anywhere;
	}

	.steps li::marker {
		font-weight: 700;
		color: var(--accent);
	}

	.warning {
		display: block;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--ordered);
	}

	.notes {
		margin: 0;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.source {
		overflow-wrap: anywhere;
	}

	.nutrition {
		margin: 0;
	}

	.archive {
		margin-top: 1.5rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
	}

	@media print {
		.photo {
			width: auto;
			max-width: 100%;
			max-height: 3in;
			aspect-ratio: auto;
		}
	}
</style>
