<script lang="ts">
	import { flushSync } from 'svelte';
	import { foldCase, normalizeName } from '../text.ts';

	// A recipe's tags as comma-separated text, with the household's other tags to tap (design 7).
	// Tapping one finishes the tag being typed when it starts the same way, or adds it after the
	// others. The server reads the text the same way: trimmed, and each tag once ignoring case.
	let {
		value = $bindable(''),
		tags,
		id
	}: { value?: string; tags: string[]; id: string } = $props();

	// The server's limit; past it, suggestions would only lead to an error.
	const MAX_TAGS = 10;

	const uid = $props.id();
	let list = $state<HTMLElement>();

	const parts = $derived(value.split(',').map(normalizeName));
	const used = $derived(new Set(parts.filter((part) => part !== '').map(foldCase)));
	// The text after the last comma, while it isn't a whole tag yet.
	const typing = $derived.by(() => {
		const last = parts.at(-1) ?? '';
		return tags.some((tag) => foldCase(tag) === foldCase(last)) ? '' : last;
	});

	function finishes(tag: string) {
		return typing !== '' && foldCase(tag).startsWith(foldCase(typing));
	}

	const suggestions = $derived.by(() => {
		if (used.size - (typing === '' ? 0 : 1) >= MAX_TAGS) return [];
		const unused = tags.filter((tag) => !used.has(foldCase(tag)));
		const finishing = unused.filter(finishes);
		return finishing.length > 0 ? finishing : unused;
	});

	function add(tag: string, index: number) {
		const kept = finishes(tag) ? parts.slice(0, -1) : parts;
		flushSync(() => {
			value = [...kept, tag].filter((part) => part !== '').join(', ');
		});
		// The tapped tag is gone from the list, so focus moves to the one now in its place.
		const buttons = list?.querySelectorAll('button');
		const next = buttons?.[Math.min(index, buttons.length - 1)];
		(next ?? document.getElementById(id))?.focus();
	}
</script>

<input
	{id}
	name="tags"
	bind:value
	maxlength="400"
	autocomplete="off"
	autocapitalize="sentences"
	aria-describedby="{uid}-help"
/>
<p class="muted help" id="{uid}-help">Separate them with commas, like Dinner, Quick.</p>
{#if suggestions.length > 0}
	<ul class="chips" aria-label="Add a tag" bind:this={list}>
		{#each suggestions as tag, index (tag)}
			<li>
				<button type="button" class="chip" aria-label="Add {tag}" onclick={() => add(tag, index)}>
					<span aria-hidden="true">+</span>
					{tag}
				</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.help {
		font-size: 0.9rem;
		margin: 0.25rem 0 0.5rem;
	}

	.chips {
		margin: 0;
	}
</style>
