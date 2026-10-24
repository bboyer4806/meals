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

	// Other navigations, such as Show all recipes or Back, set the box from the address.
	afterNavigate(({ type }) => {
		if (type !== 'form') text = value;
	});

	function cancel() {
		clearTimeout(timer);
	}

	function typed() {
		cancel();
		timer = setTimeout(() => input.form?.requestSubmit(), DELAY);
	}

	// Enter, or the form's other fields such as Sort, search right away.
	$effect(() => {
		const form = input.form;
		if (!form) throw new Error('SearchBox must be inside a form');
		form.addEventListener('submit', cancel);
		return () => form.removeEventListener('submit', cancel);
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
