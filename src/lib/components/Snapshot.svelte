<script lang="ts" generics="T">
	import { untrack } from 'svelte';
	import { afterNavigate, snapshot } from '$app/navigation';

	// Keeps a value for the tab while this is on the page, and gives it back only when the page
	// loads again in the tab (MEA-202). SvelteKit captures it when the tab is hidden or left, and on
	// its own would also give it back when Back or Forward returns to the page, or when this is
	// added to a page already showing. A snapshot's id can't change, so a parent whose id changes
	// keys this by it.
	let { id, capture, restore }: { id: string; capture: () => T; restore: (value: T) => void } =
		$props();

	// Whether the page has just loaded in the tab, known before SvelteKit gives anything back.
	let loaded = false;
	afterNavigate((navigation) => {
		loaded = navigation.type === 'enter';
	});

	snapshot({
		id: untrack(() => id),
		capture: () => capture(),
		restore: (value) => {
			if (loaded) restore(value);
		}
	});
</script>
