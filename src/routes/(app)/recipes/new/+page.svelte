<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import RecipeForm from '#lib/components/RecipeForm.svelte';
	import type { RecipeFormValues } from '#lib/server/recipe-form.ts';

	let { data, form } = $props();

	// Import from a link (design 7). The editor copies its values once, so an import makes it
	// again with the page's recipe. A failed import leaves it as it was.
	let imported = $state<RecipeFormValues | null>(null);
	let importing = $state(false);
	let problem = $state<string | null>(null);

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
				imported = (result.data as { values: RecipeFormValues }).values;
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
	{:else if imported}
		<p class="muted" role="status">Filled in from the page. Check it, then tap Save.</p>
	{/if}
</form>

<!-- The import's result never reaches `form`, so it only holds a failed save. -->
{#key imported}
	<RecipeForm
		values={imported ?? data.values}
		photoKey={null}
		tags={data.tags}
		items={data.items}
		cancelHref="/recipes"
		failure={form?.error === undefined ? null : form}
	/>
{/key}

<style>
	.help {
		font-size: 0.9rem;
		margin: 0 0 0.25rem;
	}

	form p:last-child {
		margin: 0.5rem 0 0;
	}
</style>
