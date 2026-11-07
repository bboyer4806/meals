<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { onDestroy } from 'svelte';

	// The search box of a list's GET form, which searches as people type (section 7, "Search").
	// The form carries data-sveltekit-replacestate and data-sveltekit-reset="false", so the box
	// keeps focus and typing adds no Back steps.
	let { label, value }: { label: string; value: string } = $props();

	const DELAY = 300;

	let input: HTMLInputElement;
	// What's typed, not the search the list last loaded: the load trims it, and can land while
	// someone keeps typing.
	// svelte-ignore state_referenced_locally
	let text = $state(value);
	let timer: ReturnType<typeof setTimeout> | undefined;
	// Typed and not searched yet. A page that lands meanwhile, such as a tag's list tapped just
	// before, doesn't replace it, and the search then runs with that page's tags (MEA-246).
	let unsearched = false;

	// Other navigations, such as Show all recipes or Back, set the box from the address.
	afterNavigate(({ type }) => {
		if (type !== 'form' && !unsearched) text = value;
	});

	function cancel() {
		clearTimeout(timer);
	}

	function searched() {
		cancel();
		unsearched = false;
	}

	function typed() {
		unsearched = true;
		cancel();
		timer = setTimeout(() => {
			// Offline, a search would put an error page in place of the list and lose what's
			// typed, so typing doesn't search then. Enter still does (MEA-80).
			if (navigator.onLine) input.form?.requestSubmit();
		}, DELAY);
	}

	// Enter, or the form's other fields such as Sort, search right away.
	$effect(() => {
		const form = input.form;
		if (!form) throw new Error('SearchBox must be inside a form');
		form.addEventListener('submit', searched);
		return () => form.removeEventListener('submit', searched);
	});

	onDestroy(cancel);
</script>

<label class="visually-hidden" for="q">{label}</label>
<input
	bind:this={input}
	bind:value={text}
	class="grow"
	id="q"
	name="q"
	type="search"
	placeholder="Search"
	enterkeyhint="search"
	oninput={typed}
/>
