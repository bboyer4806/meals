<script lang="ts" generics="T extends { id: number; name: string; timesAdded: number }">
	// A text field that suggests existing items as you type: names that start with the text
	// first, then names that contain it, most often added first within each (design 6.4).
	let {
		items,
		value = $bindable(''),
		id,
		name,
		placeholder,
		onpick
	}: {
		items: T[];
		value?: string;
		id: string;
		name: string;
		placeholder?: string;
		onpick: (item: T) => void;
	} = $props();

	const listId = $props.id();
	let open = $state(false);
	let active = $state(-1);

	const matches = $derived.by(() => {
		const query = value.trim().toLowerCase();
		if (query === '') return [];
		return items
			.map((item) => ({ item, position: item.name.toLowerCase().indexOf(query) }))
			.filter((match) => match.position >= 0)
			.sort(
				(a, b) =>
					Number(b.position === 0) - Number(a.position === 0) ||
					b.item.timesAdded - a.item.timesAdded ||
					a.item.name.localeCompare(b.item.name)
			)
			.slice(0, 8)
			.map((match) => match.item);
	});

	const showList = $derived(open && matches.length > 0);

	function pick(item: T) {
		value = item.name;
		open = false;
		active = -1;
		onpick(item);
	}

	function onkeydown(event: KeyboardEvent) {
		if (!showList) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			active = (active + 1) % matches.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			active = (active - 1 + matches.length) % matches.length;
		} else if (event.key === 'Enter' && active >= 0) {
			event.preventDefault();
			const item = matches[active];
			if (item) pick(item);
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
			{#each matches as item, i (item.id)}
				<li
					id="{listId}-{i}"
					role="option"
					tabindex="-1"
					aria-selected={i === active}
					onmousedown={(event) => {
						// Keep focus in the field, and pick before the field's blur closes the list.
						event.preventDefault();
						pick(item);
					}}
				>
					{item.name}
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
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		cursor: pointer;
	}

	li[aria-selected='true'],
	li:hover {
		background: var(--surface-sunk);
	}
</style>
