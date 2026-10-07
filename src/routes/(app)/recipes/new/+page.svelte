<script lang="ts">
	import RecipeForm from '#lib/components/RecipeForm.svelte';

	let { data, form } = $props();
</script>

<svelte:head>
	<title>New recipe · Meals</title>
</svelte:head>

<h1>New recipe</h1>

<RecipeForm
	values={data.values}
	photoKey={null}
	tags={data.tags}
	items={data.items}
	cancelHref="/recipes"
	failure={form}
/>
