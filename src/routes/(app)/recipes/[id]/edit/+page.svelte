<script lang="ts">
	import { page } from '$app/state';
	import RecipeForm from '#lib/components/RecipeForm.svelte';

	let { data, form } = $props();

	// The servings the recipe was shown at, which its Edit passes on, so Cancel returns to them
	// (MEA-156).
	const servings = $derived(page.url.searchParams.get('servings'));
</script>

<svelte:head>
	<title>Edit {data.dish.name} · Meals</title>
</svelte:head>

<h1>Edit recipe</h1>

<!-- A fresh form for each recipe, even when history goes straight from one editor to another. -->
{#key data.dish.id}
	<RecipeForm
		values={data.values}
		photoKey={data.dish.photoKey}
		tags={data.tags}
		items={data.items}
		cancelHref={servings === null
			? `/recipes/${data.dish.id}`
			: `/recipes/${data.dish.id}?servings=${encodeURIComponent(servings)}`}
		failure={form}
	/>
{/key}
