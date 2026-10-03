<script lang="ts" generics="T extends { id: number; name: string; timesAdded: number }">
	import { foldCase, normalizeName } from '../text.ts';

	// A text field that suggests existing items as you type: names that start with the text
	// first, then names that contain it, most often added first within each. A name that
	// matches no item offers "Add as a new item" (design 6.4).
	let {
		items,
		value = $bindable(''),
		id,
		name,
		placeholder
	}: {
		items: T[];
		value?: string;
		id: string;
		name: string;
		placeholder?: string;
	} = $props();

	type Option = { kind: 'item'; item: T } | { kind: 'new' };

	const listId = $props.id();
	let open = $state(false);
	let active = $state(-1);

	const typed = $derived(normalizeName(value));

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
		return exists ? matches : [...matches, { kind: 'new' }];
	});

	const showList = $derived(open && options.length > 0);

	function choose(option: Option) {
		if (option.kind === 'item') value = option.item.name;
		open = false;
		active = -1;
	}

	function onkeydown(event: KeyboardEvent) {
		if (!showList) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			active = (active + 1) % options.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			active = (active - 1 + options.length) % options.length;
		} else if (event.key === 'Enter' && active >= 0) {
			event.preventDefault();
			const option = options[active];
			if (option) choose(option);
		} else if (event.key === 'Escape') {
			open = false;
		}
	}
</script>

<div class="combo">
	<input
		{id}
		{name}
		{placeholder}
		bind:value
		type="text"
		autocomplete="off"
		autocapitalize="sentences"
		maxlength="80"
		required
		role="combobox"
		aria-autocomplete="list"
		aria-expanded={showList}
		aria-controls={listId}
		aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
		oninput={() => {
			open = true;
			active = -1;
		}}
		onfocus={() => (open = true)}
		onblur={() => (open = false)}
		{onkeydown}
	/>
	{#if showList}
		<ul id={listId} role="listbox">
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
						Add “{typed}” as a new item
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
		z-index: 10;
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
