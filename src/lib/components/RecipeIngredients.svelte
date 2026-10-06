<script lang="ts" module>
	import type { RecipeRow } from '../server/recipe-form.ts';

	/** A row of the editor, with a key that stays with it when rows move. */
	export type EditorRow = RecipeRow & { key: number };

	export function blankIngredient(key: number): EditorRow {
		return { kind: 'ingredient', amount: '', unit: '', item: '', prepNote: '', key };
	}
</script>

<script lang="ts">
	import { flushSync } from 'svelte';
	import { KNOWN_UNITS } from '../units.ts';
	import ItemInput from './ItemInput.svelte';

	// A recipe's ingredient rows (design 7, Edit recipe): amount, unit, item and prep note, and
	// section headings between them. A heading applies to the rows after it, up to the next one.
	// Rows move with up and down buttons. The server leaves out rows with nothing typed in them.
	let {
		rows = $bindable(),
		items
	}: {
		rows: EditorRow[];
		items: { id: number; name: string; timesAdded: number }[];
	} = $props();

	const uid = $props.id();

	// What each row is called here and in the server's messages ("Ingredient 3 needs an item"):
	// ingredients and headings are counted apart, blank rows included.
	const labels = $derived.by(() => {
		let ingredients = 0;
		let sections = 0;
		return rows.map((row) =>
			row.kind === 'section' ? `Section ${++sections}` : `Ingredient ${++ingredients}`
		);
	});

	function fieldId(key: number, field: string) {
		return `${uid}-${key}-${field}`;
	}

	function nextKey() {
		return rows.reduce((max, row) => Math.max(max, row.key), 0) + 1;
	}

	function isBlank(row: EditorRow) {
		return (
			row.kind === 'ingredient' &&
			[row.amount, row.unit, row.item, row.prepNote].every((text) => text.trim() === '')
		);
	}

	/**
	 * Changes the rows at once and then focuses a field, while the tap is still being handled:
	 * phones only open the keyboard for a field focused then.
	 */
	function change(update: () => void, focusId: string) {
		flushSync(update);
		document.getElementById(focusId)?.focus();
	}

	function addIngredient() {
		const key = nextKey();
		change(() => rows.push(blankIngredient(key)), fieldId(key, 'item'));
	}

	function addSection() {
		const key = nextKey();
		const heading: EditorRow = { kind: 'section', heading: '', key };
		const last = rows.at(-1);
		change(() => {
			// A blank row at the end becomes the section's first ingredient.
			if (last && isBlank(last)) rows.splice(rows.length - 1, 0, heading);
			else rows.push(heading, blankIngredient(key + 1));
		}, fieldId(key, 'heading'));
	}

	function move(index: number, by: -1 | 1) {
		const row = rows[index];
		const other = rows[index + by];
		if (!row || !other) return;
		const to = index + by;
		// The tapped button keeps focus, unless the row reached the end and it's now turned off.
		let button = by < 0 ? 'up' : 'down';
		if (to === 0) button = 'down';
		if (to === rows.length - 1) button = 'up';
		change(() => {
			rows[index] = other;
			rows[to] = row;
		}, fieldId(row.key, button));
	}

	function remove(index: number) {
		const neighbor = rows[index + 1] ?? rows[index - 1];
		// A button rather than a field, so a phone doesn't open its keyboard.
		change(() => rows.splice(index, 1), neighbor ? fieldId(neighbor.key, 'remove') : `${uid}-add`);
	}
</script>

{#if rows.length === 0}
	<p class="muted">No ingredients yet.</p>
{/if}

<ol class="rows">
	{#each rows as row, index (row.key)}
		{@const label = labels[index] ?? ''}
		<li class:section={row.kind === 'section'}>
			<div role="group" aria-labelledby={fieldId(row.key, 'label')}>
				<div class="head">
					<span class="label" id={fieldId(row.key, 'label')}>{label}</span>
					<button
						type="button"
						class="icon"
						id={fieldId(row.key, 'up')}
						aria-label="Move {label.toLowerCase()} up"
						disabled={index === 0}
						onclick={() => move(index, -1)}>↑</button
					>
					<button
						type="button"
						class="icon"
						id={fieldId(row.key, 'down')}
						aria-label="Move {label.toLowerCase()} down"
						disabled={index === rows.length - 1}
						onclick={() => move(index, 1)}>↓</button
					>
					<button
						type="button"
						class="icon"
						id={fieldId(row.key, 'remove')}
						aria-label="Remove {label.toLowerCase()}"
						onclick={() => remove(index)}>✕</button
					>
				</div>
				{#if row.kind === 'section'}
					<label class="visually-hidden" for={fieldId(row.key, 'heading')}>Heading</label>
					<input
						id={fieldId(row.key, 'heading')}
						class="heading"
						bind:value={row.heading}
						maxlength="60"
						autocomplete="off"
						autocapitalize="sentences"
						placeholder="Heading, like For the sauce"
					/>
				{:else}
					<label class="visually-hidden" for={fieldId(row.key, 'item')}>Item</label>
					<ItemInput
						id={fieldId(row.key, 'item')}
						name="ingredientItem"
						placeholder="Item, like flour"
						{items}
						bind:value={row.item}
						required={false}
					/>
					<div class="amounts">
						<label class="visually-hidden" for={fieldId(row.key, 'amount')}>Amount</label>
						<input
							id={fieldId(row.key, 'amount')}
							class="amount"
							bind:value={row.amount}
							maxlength="20"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							placeholder="Amount"
						/>
						<label class="visually-hidden" for={fieldId(row.key, 'unit')}>Unit</label>
						<input
							id={fieldId(row.key, 'unit')}
							class="unit"
							list="{uid}-units"
							bind:value={row.unit}
							maxlength="20"
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							placeholder="Unit"
						/>
						<label class="visually-hidden" for={fieldId(row.key, 'prep')}>Prep note</label>
						<input
							id={fieldId(row.key, 'prep')}
							class="prep"
							bind:value={row.prepNote}
							maxlength="80"
							autocomplete="off"
							placeholder="Prep note"
						/>
					</div>
				{/if}
			</div>
		</li>
	{/each}
</ol>

<p class="muted help">Amounts like 2, 1 1/2 or ½. Pick a unit or type your own, like cloves.</p>

<div class="add">
	<button type="button" id="{uid}-add" onclick={addIngredient}>Add ingredient</button>
	<button type="button" onclick={addSection}>Add section</button>
</div>

<datalist id="{uid}-units">
	{#each KNOWN_UNITS as unit (unit.code)}
		<option value={unit.code}></option>
	{/each}
</datalist>

<style>
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		padding: 0.25rem 0 0.75rem;
		border-top: 1px solid var(--border);
	}

	li:first-child {
		border-top: none;
	}

	/* A heading stands out from the ingredients it starts. */
	li.section {
		margin: 0 -1rem;
		padding-inline: 1rem;
		background: var(--surface-sunk);
	}

	.head {
		display: flex;
		align-items: center;
	}

	.label {
		flex: 1;
		font-size: 0.85rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}

	.icon {
		width: var(--tap);
		padding: 0;
		border-color: transparent;
		background: none;
		color: var(--accent);
		font-size: 1.15rem;
	}

	.heading {
		font-weight: 700;
	}

	.amounts {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.amounts input {
		padding-inline: 0.6rem;
	}

	.amount {
		flex: none;
		width: 5.25rem;
	}

	.unit {
		flex: none;
		width: 5rem;
	}

	.prep {
		flex: 1;
		min-width: 0;
	}

	.help {
		font-size: 0.9rem;
		margin: 0.5rem 0;
	}

	.add {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}

	.add button {
		padding-inline: 0.5rem;
	}
</style>
