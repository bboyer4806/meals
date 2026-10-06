<script lang="ts">
	import RecipeForm from '#lib/components/RecipeForm.svelte';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>Edit {data.dish.name} · Meals</title>
</svelte:head>

<h1>Edit recipe</h1>

<RecipeForm
	values={data.values}
	photoKey={data.dish.photoKey}
	tags={data.tags}
	items={data.items}
	cancelHref="/recipes/{data.dish.id}"
	failure={form}
/>
