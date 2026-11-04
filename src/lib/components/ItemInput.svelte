<script lang="ts" generics="T extends { id: number; name: string; timesAdded: number }">
	import { onMount, tick, type Snippet } from 'svelte';
	import { foldCase, normalizeName } from '../text.ts';

	// A text field that suggests existing items as you type: names that start with the text
	// first, then names that contain it, most often added first within each. A name that
	// matches no item offers "Add as a new item" (design 6.4). The recipe editor turns off
	// `required`, since a blank ingredient row is left out rather than refused. The dinner
	// editor suggests dishes, so its new option says "new dish", and it adds a dish picked from
	// them right away, with its role and Add under the field (MEA-56). The dish request sheet
	// suggests dishes too, with the name's limit warning under the field, so they show in the
	// sheet rather than over its Note and Request (6.12, MEA-151).
	let {
		items,
		value = $bindable(''),
		id,
		name,
		placeholder,
		required = true,
		noun = 'item',
		problemId,
		onchoose,
		children
	}: {
		items: T[];
		value?: string;
		id: string;
		name: string;
		placeholder?: string;
		required?: boolean;
		/** What a name that matches nothing would be added as; null offers nothing for it. */
		noun?: string | null;
		/**
		 * The id of a problem shown with the field, such as the recipe editor's from a failed save.
		 * The field is then marked invalid and described by it.
		 */
		problemId?: string;
		/** Called once the field shows an existing item someone chose from the suggestions. */
		onchoose?: () => void;
		/**
		 * Shown under the field, such as the button that adds what's typed. The suggestions then
		 * show in the page under it, about four at a time, so they never cover or move it.
		 * Without it, they show over the page, under the field.
		 */
		children?: Snippet;
	} = $props();

	type Option = { kind: 'item'; item: T } | { kind: 'new' };

	const listId = $props.id();
	let open = $state(false);
	let active = $state(-1);

	const typed = $derived(normalizeName(value));
	const inline = $derived(children !== undefined);

	const options = $derived.by((): Option[] => {
		if (typed === '') return [];
		const query = foldCase(typed);
		const matches = items
			.map((item) => ({ item, position: foldCase(item.name).indexOf(query) }))
			.filter((match) => match.position >= 0)
			.sort(
				(a, b) =>
					Number(b.position === 0) - Number(a.position === 0) ||
					b.item.timesAdded - a.item.timesAdded ||
					a.item.name.localeCompare(b.item.name)
			)
			.slice(0, 8)
			.map((match): Option => ({ kind: 'item', item: match.item }));
		const exists = items.some((item) => foldCase(item.name) === query);
		return exists || noun === null ? matches : [...matches, { kind: 'new' }];
	});

	const showList = $derived(open && options.length > 0);

	// Someone can tap the field and type before the page's script starts, which keeps what they
	// typed but misses its focus and input, so show the suggestions for it once the script runs.
	let input: HTMLInputElement;
	onMount(() => {
		if (document.activeElement === input) open = true;
	});

	// A press outside the field, what's under it and its suggestions takes focus from the field as
	// it starts, but suggestions in the page close only once it's let go. Closing them moves
	// what's after them, and everything in a sheet centered on a computer, so the press would
	// land on whatever moved under it rather than what it was aimed at, such as the dish request
	// sheet's Note or Request (MEA-151).
	let combo: HTMLDivElement;
	let closeOnRelease = false;

	function press(event: MouseEvent) {
		if (inline && showList && !combo.contains(event.target as Node)) closeOnRelease = true;
	}

	function release() {
		if (!closeOnRelease) return;
		closeOnRelease = false;
		if (document.activeElement !== input) open = false;
	}

	async function choose(option: Option) {
		open = false;
		active = -1;
		if (option.kind === 'new') return;
		value = option.item.name;
		if (!onchoose) return;
		// Once the field shows the name, so a form sent from here sends it.
		await tick();
		onchoose();
	}

	function moveTo(index: number) {
		active = index;
		// The suggestions in the page scroll, so the one the arrow keys reach is scrolled to.
		if (!inline) return;
		document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: 'nearest' });
	}

	function onkeydown(event: KeyboardEvent) {
		if (!showList) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			moveTo((active + 1) % options.length);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			moveTo(active <= 0 ? options.length - 1 : active - 1);
		} else if (event.key === 'Enter' && active >= 0) {
			event.preventDefault();
			const option = options[active];
			if (option) choose(option);
		} else if (event.key === 'Escape') {
			open = false;
		}
	}
</script>

<svelte:window onmousedowncapture={press} onmouseupcapture={release} />

<div class="combo" class:inline bind:this={combo}>
	<input
		bind:this={input}
		{id}
		{name}
		{placeholder}
		bind:value
		type="text"
		autocomplete="off"
		autocapitalize="sentences"
		maxlength="80"
		{required}
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={showList}
		aria-controls={listId}
		aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
		aria-invalid={problemId === undefined ? undefined : true}
		aria-describedby={problemId}
		oninput={() => {
			open = true;
			active = -1;
		}}
		onfocus={() => {
			closeOnRelease = false;
			open = true;
		}}
		onblur={() => {
			if (!closeOnRelease) open = false;
		}}
		{onkeydown}
	/>
	{@render children?.()}
	{#if showList}
		<!-- Out of the Tab order, so Tab from the field goes past the suggestions. In the page they
		     scroll, and the browser would otherwise stop on them just as they close, leaving focus
		     nowhere (MEA-151). -->
		<ul id={listId} role="listbox" tabindex="-1">
			{#each options as option, i (option.kind === 'item' ? option.item.id : 'new')}
				<li
					id="{listId}-{i}"
					role="option"
					tabindex="-1"
					class:new={option.kind === 'new'}
					aria-selected={i === active}
					onmousedown={(event) => {
						// Keep focus in the field, and choose before the field's blur closes the list.
						event.preventDefault();
						choose(option);
					}}
				>
					{#if option.kind === 'item'}
						{option.item.name}
					{:else}
						Add “{typed}” as a new {noun}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.combo {
		position: relative;
	}

	ul {
		position: absolute;
		/* Above the sticky header and the tab bar. */
		z-index: 30;
		left: 0;
		right: 0;
		top: calc(100% + 4px);
		margin: 0;
		padding: 0.25rem;
		list-style: none;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	/* Under what's shown below the field, in the page. About four and a half suggestions show,
	   so it's clear the rest scroll. */
	.inline {
		display: grid;
		gap: 0.5rem;
	}

	.inline ul {
		position: static;
		/* In the page, so under the sticky header, the tab bar and the feedback button like the
		   rest of it. A grid item's z-index applies even though it's static (MEA-143). */
		z-index: auto;
		max-height: 13rem;
		overflow-y: auto;
	}

	li {
		display: flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 0.75rem;
		border-radius: 8px;
		cursor: pointer;
	}

	li.new {
		color: var(--accent);
		font-weight: 600;
	}

	li[aria-selected='true'],
	li:hover {
		background: var(--surface-sunk);
	}
</style>
