<script lang="ts">
	import { page } from '$app/state';
	import { helpFor } from '../help.ts';
	import Sheet from './Sheet.svelte';

	// The Help button in the header and its sheet, which explains the screen it's opened on
	// (design 7, "Help"). Opening it changes nothing on the page behind, so anything typed there
	// and not saved stays.

	const help = $derived(helpFor(page.route.id));
	let open = $state(false);
</script>

<button type="button" class="help" onclick={() => (open = true)}>Help</button>

<Sheet bind:open title="Help: {help.title}">
	<ul>
		{#each help.points as point (point)}
			<li>{point}</li>
		{/each}
	</ul>
</Sheet>

<style>
	/* Matches More beside it. */
	.help {
		padding: 0 0.75rem;
	}

	ul {
		margin: 0;
		padding-left: 1.25rem;
	}

	li + li {
		margin-top: 0.5rem;
	}
</style>
