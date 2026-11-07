<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import RecipeForm from '#lib/components/RecipeForm.svelte';
	import type { ImportedRecipe, LeftOut } from '#lib/recipe-schema.ts';
	import { joinAnd } from '#lib/text.ts';

	let { data, form } = $props();

	// Import from a link (design 7) fills in the editor in place, keeping its photo, tags and
	// notes, and asks first when that replaces anything else typed or changed. A failed import,
	// or Cancel, leaves the editor as it was.
	let editor: ReturnType<typeof RecipeForm>;
	// What the page says once an import has filled in the editor.
	let filled = $state<string | null>(null);
	let importing = $state(false);
	let problem = $state<string | null>(null);

	// What an import leaves out of a page with more than the editor takes (MEA-84).
	const LEFT_OUT: Record<LeftOut, string> = {
		ingredients: 'ingredients after the first 100',
		steps: 'steps after the first 10,000 characters'
	};

	/**
	 * "Filled in from the page. Check it, then tap Save.", or with what was left out: "Filled in
	 * from the page, leaving out ingredients after the first 100. Check it, then tap Save."
	 */
	function filledMessage(leftOut: LeftOut[]): string {
		const parts = leftOut.map((field) => LEFT_OUT[field]);
		const left = parts.length > 0 ? `, leaving out ${joinAnd(parts)}` : '';
		return `Filled in from the page${left}. Check it, then tap Save.`;
	}

	// Filling the editor in needs the page's script, so Import waits for it.
	let ready = $state(false);
	onMount(() => (ready = true));

	const importRecipe: SubmitFunction = ({ cancel }) => {
		if (importing) return cancel();
		importing = true;
		problem = null;
		return async ({ result, update }) => {
			importing = false;
			// Nothing here resets the form, so the link stays in its field.
			if (result.type === 'success') {
				if (!editor.confirmFill()) return;
				const { values, leftOut } = result.data as ImportedRecipe;
				editor.fill(values);
				filled = filledMessage(leftOut);
			} else if (result.type === 'failure') {
				problem = (result.data as { error: string }).error;
			} else if (result.type === 'redirect') {
				// Signed out.
				await update();
			} else {
				problem = "The recipe couldn't be imported. Check your connection and try again.";
			}
		};
	};
</script>

<svelte:head>
	<title>New recipe · Meals</title>
</svelte:head>

<h1>New recipe</h1>

<form class="card" method="POST" action="?/import" use:enhance={importRecipe}>
	<label for="link">Link</label>
	<p class="muted help" id="link-help">Paste a recipe's web address to fill in the recipe below.</p>
	<div class="row">
		<input
			class="grow"
			id="link"
			name="link"
			type="url"
			required
			maxlength="500"
			autocomplete="off"
			aria-describedby="link-help"
		/>
		<button disabled={!ready || importing}>{importing ? 'Importing…' : 'Import'}</button>
	</div>
	{#if problem}
		<p class="error" role="alert">{problem}</p>
	{:else if filled}
		<p class="muted" role="status">{filled}</p>
	{/if}
</form>

<!-- The import's result never reaches `form`, so it only holds a failed save. -->
<RecipeForm
	bind:this={editor}
	values={data.values}
	photoKey={null}
	tags={data.tags}
	items={data.items}
	cancelHref="/recipes"
	failure={form?.action === 'recipe' ? form : null}
/>

<style>
	.help {
		font-size: 0.9rem;
		margin: 0 0 0.25rem;
	}

	form p:last-child {
		margin: 0.5rem 0 0;
	}
</style>
