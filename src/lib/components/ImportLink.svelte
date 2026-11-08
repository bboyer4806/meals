<script lang="ts" module>
	import type { LeftOut } from '../recipe-schema.ts';
	import { joinAnd } from '../text.ts';

	// What an import leaves out of a page with more than the editor takes (MEA-84).
	const LEFT_OUT: Record<LeftOut, string> = {
		ingredients: 'ingredients after the first 100',
		steps: 'steps after the first 10,000 characters'
	};

	/**
	 * "Filled in from the page. Check it, then tap Save.", or with what was left out: "Filled in
	 * from the page, leaving out ingredients after the first 100. Check it, then tap Save."
	 */
	export function filledMessage(leftOut: LeftOut[]): string {
		const parts = leftOut.map((field) => LEFT_OUT[field]);
		const left = parts.length > 0 ? `, leaving out ${joinAnd(parts)}` : '';
		return `Filled in from the page${left}. Check it, then tap Save.`;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';

	// The Link field and Import above the recipe editor (design 7, Import from a link), on New
	// recipe and Edit recipe (MEA-264). Import has the server read the page's recipe, saving
	// nothing, and gives what it read to `onimport`, which fills in the editor. A failed import
	// says why here and leaves the editor as it was. Either way the link stays in its field.
	let {
		help,
		status,
		onimport
	}: {
		/** What Import does, under the Link label. */
		help: string;
		/** What the page says once an import has filled in the editor, if anything. */
		status: string | null;
		/** Takes the import action's data. */
		onimport: (data: Record<string, unknown>) => void;
	} = $props();

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
				onimport(result.data ?? {});
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

<form class="card" method="POST" action="?/import" use:enhance={importRecipe}>
	<label for="link">Link</label>
	<p class="muted help" id="link-help">{help}</p>
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
	{:else if status}
		<p class="muted" role="status">{status}</p>
	{/if}
</form>

<style>
	.help {
		font-size: 0.9rem;
		margin: 0 0 0.25rem;
	}

	form p:last-child {
		margin: 0.5rem 0 0;
	}
</style>
