<script lang="ts">
	import ImportLink, { filledMessage } from '#lib/components/ImportLink.svelte';
	import RecipeForm from '#lib/components/RecipeForm.svelte';
	import type { ImportedRecipe } from '#lib/recipe-schema.ts';

	let { data, form } = $props();

	// Import from a link (design 7) fills in the editor in place, keeping its photo, tags and
	// notes, and asks first when that replaces anything else typed or changed. A failed import,
	// or Cancel, leaves the editor as it was.
	let editor: ReturnType<typeof RecipeForm>;
	// What the page says once an import has filled in the editor.
	let filled = $state<string | null>(null);

	function fill(imported: Record<string, unknown>) {
		if (!editor.confirmFill()) return;
		const { values, leftOut } = imported as ImportedRecipe;
		editor.fill(values);
		filled = filledMessage(leftOut);
	}
</script>

<svelte:head>
	<title>New recipe · Meals</title>
</svelte:head>

<h1>New recipe</h1>

<ImportLink
	help="Paste a recipe's web address to fill in the recipe below."
	status={filled}
	onimport={fill}
/>

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
