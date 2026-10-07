<script lang="ts">
	import RecipeForm from '#lib/components/RecipeForm.svelte';

	let { data, form } = $props();
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
		cancelHref="/recipes/{data.dish.id}"
		failure={form}
	/>
{/key}
