<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import ImportLink, { filledMessage } from '#lib/components/ImportLink.svelte';
	import RecipeForm from '#lib/components/RecipeForm.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import {
		applyImport,
		changesEditor,
		ingredientText,
		nothingToReview,
		replacement,
		reviewImport,
		type Review,
		type ReviewField
	} from '#lib/recipe-merge.ts';
	import type { LeftOut, LinkValues } from '#lib/recipe-schema.ts';
	import type { RecipeFormValues } from '#lib/server/recipe-form.ts';

	let { data, form } = $props();

	// The servings the recipe was shown at, which its Edit passes on, so Cancel returns to them
	// (MEA-156).
	const servings = $derived(page.url.searchParams.get('servings'));

	// Import from a link (design 7; MEA-264) compares the page's recipe with the editor as it is,
	// unsaved changes included, and shows what it would change before anything does: empty
	// fields fill in, and anything else that's different is kept unless it's chosen
	// (recipe-merge.ts). Apply puts that in the editor, saving nothing. Cancel, or a failed
	// import, leaves the editor as it was.
	// State, as each recipe's editor is a new one.
	let editor = $state<ReturnType<typeof RecipeForm>>();
	// What the page says after an import.
	let status = $state<string | null>(null);
	let review = $state<Review | null>(null);
	let reviewing = $state(false);
	// The editor as the review compared it, and what the page has more of than the editor takes.
	let compared: RecipeFormValues;
	let leftOut: LeftOut[] = [];

	// A fresh import for each recipe, even when history goes straight from one editor to another.
	afterNavigate(() => {
		status = null;
		review = null;
		reviewing = false;
	});

	// As the editor labels the fields.
	const LABELS: Record<ReviewField, string> = {
		name: 'Name',
		servings: 'Servings',
		prepMinutes: 'Prep (min)',
		cookMinutes: 'Cook (min)',
		steps: 'Steps',
		source: 'Source',
		calories: 'Calories',
		proteinG: 'Protein (g)',
		carbsG: 'Carbs (g)',
		fatG: 'Fat (g)'
	};

	function compare(imported: Record<string, unknown>) {
		if (!editor) throw new Error('No editor to import into');
		const { values, leftOut: left } = imported as { values: LinkValues; leftOut: LeftOut[] };
		compared = editor.current();
		const next = reviewImport(compared, values);
		if (nothingToReview(next)) {
			status = 'Nothing to change. The recipe already matches the page.';
			return;
		}
		status = null;
		leftOut = left;
		review = next;
		reviewing = true;
	}

	function apply() {
		if (!editor || !review) throw new Error('No import to apply');
		editor.fill(applyImport(compared, review));
		status = filledMessage(leftOut);
		reviewing = false;
	}

	/** Whether another of the page's ingredients is chosen to replace the editor's at `at`. */
	function taken(chosen: Review, at: number, entry: number): boolean {
		return chosen.ingredients.some((other, index) => index !== entry && other.choice === at);
	}
</script>

<svelte:head>
	<title>Edit {data.dish.name} · Meals</title>
</svelte:head>

<h1>Edit recipe</h1>

<!-- A fresh form for each recipe, even when history goes straight from one editor to another. -->
{#key data.dish.id}
	<ImportLink
		help="Paste a recipe's web address to update the recipe below. You choose what it replaces."
		{status}
		onimport={compare}
	/>

	<!-- The import's result never reaches `form`, so it only holds a failed save. -->
	<RecipeForm
		bind:this={editor}
		values={data.values}
		photoKey={data.dish.photoKey}
		tags={data.tags}
		items={data.items}
		cancelHref={servings === null
			? `/recipes/${data.dish.id}`
			: `/recipes/${data.dish.id}?servings=${encodeURIComponent(servings)}`}
		failure={form?.action === 'recipe' ? form : null}
	/>
{/key}

<Sheet bind:open={reviewing} title="Import from the page">
	{#if reviewing && review}
		<p class="muted">
			Empty fields fill in from the page. Choose what else to replace: the rest stays as it is, and
			so do the photo, tags and notes.
		</p>

		{#if review.fills.length > 0}
			<h3>To fill in</h3>
			<dl class="fills">
				{#each review.fills as fill (fill.field)}
					<div>
						<dt>{LABELS[fill.field]}</dt>
						<dd class="value">{fill.imported}</dd>
					</div>
				{/each}
			</dl>
		{/if}

		{#each review.conflicts as conflict (conflict.field)}
			<fieldset>
				<legend>{LABELS[conflict.field]}</legend>
				<label class="choice">
					<input
						type="radio"
						name="replace-{conflict.field}"
						value={false}
						bind:group={conflict.replace}
					/>
					<span>Keep: <span class="value">{conflict.current}</span></span>
				</label>
				<label class="choice">
					<input
						type="radio"
						name="replace-{conflict.field}"
						value={true}
						bind:group={conflict.replace}
					/>
					<span>Replace with: <span class="value">{conflict.imported}</span></span>
				</label>
			</fieldset>
		{/each}

		{#if review.ingredients.length > 0}
			<h3>Ingredients</h3>
			{#each review.ingredients as entry, index (index)}
				{#if entry.kind === 'new'}
					<label class="choice">
						<input
							type="checkbox"
							bind:checked={
								() => entry.choice === 'add', (add) => (entry.choice = add ? 'add' : 'skip')
							}
						/>
						<span>Add {ingredientText(entry.imported)}</span>
					</label>
				{:else if entry.kind === 'match'}
					{@const replaced = replacement(entry.current.ingredient, entry.imported)}
					<fieldset>
						<legend>{entry.current.ingredient.item}</legend>
						<label class="choice">
							<input
								type="radio"
								name="ingredient-{index}"
								value="skip"
								bind:group={entry.choice}
							/>
							<span>Keep: {ingredientText(entry.current.ingredient)}</span>
						</label>
						<label class="choice">
							<input
								type="radio"
								name="ingredient-{index}"
								value={entry.current.at}
								bind:group={entry.choice}
							/>
							<span>Replace with: {ingredientText(replaced)}</span>
						</label>
					</fieldset>
				{:else}
					<!-- The editor or the page has its item more than once, so it's matched by hand. -->
					<fieldset>
						<legend>{ingredientText(entry.imported)}</legend>
						<label class="choice">
							<input
								type="radio"
								name="ingredient-{index}"
								value="skip"
								bind:group={entry.choice}
							/>
							<span>Skip</span>
						</label>
						{#each entry.candidates as candidate (candidate.at)}
							<label class="choice">
								<input
									type="radio"
									name="ingredient-{index}"
									value={candidate.at}
									disabled={taken(review, candidate.at, index)}
									bind:group={entry.choice}
								/>
								<span>
									Replace {candidate.label.toLowerCase()}: {ingredientText(candidate.ingredient)}
								</span>
							</label>
						{/each}
						<label class="choice">
							<input type="radio" name="ingredient-{index}" value="add" bind:group={entry.choice} />
							<span>Add as a new ingredient</span>
						</label>
					</fieldset>
				{/if}
			{/each}
		{/if}

		<div class="actions">
			<button type="button" class="primary" disabled={!changesEditor(review)} onclick={apply}>
				Apply
			</button>
			<button type="button" onclick={() => (reviewing = false)}>Cancel</button>
		</div>
	{/if}
</Sheet>

<style>
	h3 {
		margin-top: 1rem;
	}

	.fills {
		margin: 0;
	}

	.fills div {
		padding: 0.25rem 0;
	}

	dt {
		font-weight: 600;
	}

	dd {
		margin: 0;
	}

	fieldset {
		border: none;
		border-top: 1px solid var(--border);
		margin: 0;
		padding: 0.5rem 0;
	}

	legend {
		font-weight: 600;
		padding: 0;
	}

	/* A whole line to tap, the box or circle first. */
	.choice {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		min-height: var(--tap);
		padding: 0.5rem 0;
		margin: 0;
		font-weight: inherit;
		cursor: pointer;
	}

	.choice input {
		flex: none;
		width: 1.25rem;
		height: 1.25rem;
		min-height: 0;
		margin: 0.15rem 0 0;
		padding: 0;
		accent-color: var(--accent);
	}

	/* Steps keep their line breaks. */
	.value {
		white-space: pre-line;
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		margin-top: 1rem;
	}
</style>
