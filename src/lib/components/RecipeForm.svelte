<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { afterNavigate, beforeNavigate, goto, refreshAll } from '$app/navigation';
	import type { RecipeFailure, RecipeFormValues } from '../server/recipe-form.ts';
	import RecipeIngredients, { blankIngredient, type EditorRow } from './RecipeIngredients.svelte';
	import RecipePhoto, { type PhotoChoice } from './RecipePhoto.svelte';
	import RecipeTags from './RecipeTags.svelte';

	// The recipe editor (design 7, Edit recipe) for a new recipe and a saved one. Every field is
	// bound to state here, copied once from the page's data and never re-read from it, so what's
	// typed survives a failed save and the data reloading when someone comes back to the tab
	// (Q11). (A field with value={...} instead could be set back to that value whenever the page
	// updates around it.)
	let {
		values,
		photoKey,
		tags,
		items,
		cancelHref,
		failure = null
	}: {
		/** Where the fields start. */
		values: RecipeFormValues;
		/** The saved photo, if any. */
		photoKey: string | null;
		/** The household's tags, suggested in the tags field. */
		tags: string[];
		/** The item catalog, suggested in each ingredient's item field. */
		items: { id: number; name: string; timesAdded: number }[];
		cancelHref: string;
		/** A failure from a save that didn't go through this page's script. */
		failure?: RecipeFailure | null;
	} = $props();

	const { rows: initialRows, tags: initialTags, ...initial } = untrack(() => values);
	// Number fields put numbers back in here; the form sends the fields' text either way.
	let fields = $state<Record<keyof typeof initial, string | number | null>>(initial);
	let tagText = $state(initialTags);
	// A new recipe, or one without ingredients yet, starts with an empty row to type in.
	let rows = $state<EditorRow[]>(
		initialRows.length === 0
			? [blankIngredient(1)]
			: initialRows.map((row, index) => ({ ...row, key: index + 1 }))
	);
	let photo = $state<PhotoChoice>({ kind: 'keep' });
	let preparingPhoto = $state(false);

	// What saving would keep, to ask before leaving with it unsaved. Number fields hold numbers
	// once typed in, so everything is compared as text. As on the server, blank ingredient rows
	// are left out and each ingredient carries the heading above it, so a blank row or an empty
	// heading alone changes nothing.
	function typed(): string {
		const text = Object.values(fields).map((value) => String(value ?? ''));
		const ingredients: string[][] = [];
		let section = '';
		for (const row of rows) {
			if (row.kind === 'section') {
				section = row.heading.trim();
				continue;
			}
			const cells = [row.amount, row.unit, row.item, row.prepNote].map((cell) => cell.trim());
			if (cells.some((cell) => cell !== '')) ingredients.push([section, ...cells]);
		}
		return JSON.stringify([text, tagText, ingredients, photo.kind]);
	}
	const typedAtStart = typed();
	// Set once the recipe is saved or the person agreed to drop it, so leaving doesn't ask.
	let done = false;
	const LEAVE = 'Leave without saving? What you typed will be lost.';

	// Saving needs the page's script (the rows are sent as one field), so Save waits for it.
	let ready = $state(false);
	onMount(() => (ready = true));

	// A save or a restore on its way. Each stays busy until its recipe opens, so it can't be sent
	// twice.
	let saving = $state(false);
	let restoring = $state(false);
	// The navigation the person chose meanwhile. The save or restore then leaves them there.
	let leftWhileBusy: Promise<void> | null = null;
	// Set for the editor's own navigation to the recipe.
	let finishing = false;

	beforeNavigate((navigation) => {
		if (finishing) return;
		if (!done && typed() !== typedAtStart) {
			// Closing the tab or leaving the site: the browser asks.
			if (navigation.type === 'leave') return navigation.cancel();
			const question = saving
				? "The recipe is still saving. Leave anyway? If it doesn't save, what you typed will be lost."
				: LEAVE;
			if (!confirm(question)) return navigation.cancel();
		}
		if (saving || restoring) leftWhileBusy = navigation.complete;
	});

	// The page before the editor in history, so saving can go back to it. Not when the editor
	// was reached with Back, since the page it came from is then the one after it.
	let openedFrom: string | null | undefined;
	afterNavigate((navigation) => {
		if (openedFrom !== undefined) return;
		const back = navigation.type === 'popstate' && navigation.delta < 0;
		openedFrom = back ? null : (navigation.from?.url.pathname ?? null);
	});

	/** After a save or a restore went through: on to the recipe, unless the person left. */
	async function finish(to: string) {
		done = true;
		if (leftWhileBusy) {
			// Once they're there, it shows what changed.
			await leftWhileBusy.catch(() => {});
			await refreshAll();
			return;
		}
		finishing = true;
		// So that Back from the recipe doesn't open the editor again: opened from that recipe's
		// page, it goes back to that page; otherwise the recipe takes the editor's place.
		const recipe = new URL(to, location.href);
		if (recipe.pathname === openedFrom) history.back();
		else await goto(recipe, { replace: true, refreshAll: true });
	}

	// Restoring the other recipe drops this one, so it asks before anything changes.
	const restore: SubmitFunction = ({ cancel }) => {
		if (restoring) return cancel();
		if (typed() !== typedAtStart && !confirm(LEAVE)) return cancel();
		done = true;
		restoring = true;
		return async ({ result, update }) => {
			if (result.type === 'redirect') return finish(result.location);
			restoring = false;
			await update();
		};
	};

	let problem = $state<RecipeFailure | null>(untrack(() => failure));
	let problemElement = $state<HTMLElement>();

	async function show(next: RecipeFailure) {
		problem = next;
		await tick();
		problemElement?.focus();
	}

	const submit: SubmitFunction = ({ formData, cancel }) => {
		if (saving || preparingPhoto) {
			cancel();
			return;
		}
		// The rows go as one field, in order, without their keys. The item fields are named only
		// because ItemInput needs a name.
		formData.delete('ingredientItem');
		formData.set('ingredients', JSON.stringify(rows.map(({ key: _, ...row }) => row)));
		if (photo.kind === 'new') {
			formData.set('photo', photo.photo, 'photo.jpg');
			formData.set('thumb', photo.thumb, 'thumb.jpg');
		} else if (photo.kind === 'remove') {
			formData.set('removePhoto', '1');
		}
		saving = true;
		problem = null;

		return async ({ result, update }) => {
			const signedOut =
				result.type === 'redirect' &&
				new URL(result.location, location.href).pathname === '/login';
			if (result.type === 'redirect' && !signedOut) return finish(result.location);
			saving = false;
			// Nothing here clears or reloads the form, so everything typed and the picked photo
			// stay for another try.
			if (result.type === 'failure') {
				await show(result.data as RecipeFailure);
			} else if (result.type === 'error') {
				// The action never ran, the connection dropped, or something broke on the server.
				const error =
					result.status === 413
						? 'That photo is too large. Try another one.'
						: "The recipe couldn't be saved. Check your connection and try again.";
				await show({ action: 'recipe', error });
			} else if (signedOut) {
				await show({
					action: 'recipe',
					error: "You've been signed out. Sign in again in another tab, then save."
				});
			} else {
				await update({ reset: false });
			}
		};
	};

	// Enter in a one-line field goes to the next field, as a phone's Next key does, rather than
	// saving a recipe that's half typed. An item field's suggestions use Enter first.
	function nextOnEnter(event: KeyboardEvent & { currentTarget: HTMLFormElement }) {
		const field = event.target;
		if (event.key !== 'Enter' || event.defaultPrevented || event.isComposing) return;
		if (!(field instanceof HTMLInputElement)) return;
		event.preventDefault();
		const typed = [...event.currentTarget.elements].filter(
			(element) =>
				(element instanceof HTMLInputElement && element.type !== 'file') ||
				element instanceof HTMLTextAreaElement
		);
		(typed[typed.indexOf(field) + 1] as HTMLElement | undefined)?.focus();
	}
</script>

{#if problem}
	<div class="problem card">
		<p class="error" role="alert" tabindex="-1" bind:this={problemElement}>{problem.error}</p>
		{#if problem.archivedId}
			<form method="POST" action="/recipes/{problem.archivedId}?/restore" use:enhance={restore}>
				<button disabled={restoring}>{restoring ? 'Restoring…' : 'Restore it'}</button>
			</form>
		{/if}
	</div>
{/if}

<!-- The keydown handler only watches Enter in the form's own fields (nextOnEnter). -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<form
	method="POST"
	action="?/save"
	enctype="multipart/form-data"
	use:enhance={submit}
	onkeydown={nextOnEnter}
>
	<section class="card">
		<div class="field">
			<label for="name">Name</label>
			<input
				id="name"
				name="name"
				required
				maxlength="80"
				autocomplete="off"
				autocapitalize="sentences"
				bind:value={fields.name}
			/>
		</div>

		<div class="field" role="group" aria-labelledby="photo-label">
			<span class="label" id="photo-label">Photo</span>
			<RecipePhoto savedKey={photoKey} bind:choice={photo} bind:busy={preparingPhoto} />
		</div>

		<div class="numbers">
			<div class="field">
				<label for="servings">Servings</label>
				<input
					id="servings"
					name="servings"
					type="number"
					inputmode="numeric"
					min="1"
					max="100"
					step="1"
					required
					bind:value={fields.servings}
				/>
			</div>
			<div class="field">
				<label for="prepMinutes">Prep (min)</label>
				<input
					id="prepMinutes"
					name="prepMinutes"
					type="number"
					inputmode="numeric"
					min="0"
					max="10000"
					step="1"
					bind:value={fields.prepMinutes}
				/>
			</div>
			<div class="field">
				<label for="cookMinutes">Cook (min)</label>
				<input
					id="cookMinutes"
					name="cookMinutes"
					type="number"
					inputmode="numeric"
					min="0"
					max="10000"
					step="1"
					bind:value={fields.cookMinutes}
				/>
			</div>
		</div>

		<div class="field last">
			<label for="tags">Tags</label>
			<RecipeTags id="tags" bind:value={tagText} {tags} />
		</div>
	</section>

	<section class="card" aria-labelledby="ingredients-heading">
		<h2 id="ingredients-heading">Ingredients</h2>
		<RecipeIngredients bind:rows {items} />
	</section>

	<section class="card">
		<div class="field">
			<label for="steps">Steps</label>
			<p class="muted help" id="steps-help">One step per line.</p>
			<textarea
				id="steps"
				name="steps"
				rows="8"
				maxlength="10000"
				aria-describedby="steps-help"
				bind:value={fields.steps}
			></textarea>
		</div>
		<div class="field">
			<label for="notes">Notes</label>
			<textarea id="notes" name="notes" rows="3" maxlength="2000" bind:value={fields.notes}
			></textarea>
		</div>
		<div class="field last">
			<label for="source">Source</label>
			<input
				id="source"
				name="source"
				maxlength="500"
				autocomplete="off"
				placeholder="A web address or a book"
				bind:value={fields.source}
			/>
		</div>
	</section>

	<section class="card" aria-labelledby="nutrition-heading">
		<h2 id="nutrition-heading">Nutrition per serving</h2>
		<div class="nutrition">
			{@render nutrient('calories', 'Calories')}
			{@render nutrient('proteinG', 'Protein (g)')}
			{@render nutrient('carbsG', 'Carbs (g)')}
			{@render nutrient('fatG', 'Fat (g)')}
		</div>
	</section>

	<div class="actions">
		<button class="primary" disabled={!ready || saving || preparingPhoto}>
			{saving ? 'Saving…' : 'Save'}
		</button>
		<a class="button" href={cancelHref}>Cancel</a>
	</div>
</form>

{#snippet nutrient(name: 'calories' | 'proteinG' | 'carbsG' | 'fatG', label: string)}
	<div>
		<label for={name}>{label}</label>
		<input
			id={name}
			{name}
			type="number"
			inputmode="decimal"
			min="0"
			max="100000"
			step="any"
			bind:value={fields[name]}
		/>
	</div>
{/snippet}

<style>
	.problem {
		border-color: var(--danger);
	}

	.problem p {
		margin: 0;
		/* Clear of the sticky header when it's focused and scrolled to. */
		scroll-margin-top: 6rem;
	}

	.problem form {
		margin-top: 0.75rem;
	}

	.label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.field.last {
		margin-bottom: 0;
	}

	/* Servings needs less room than the times, so their labels fit on one line on a phone. */
	.numbers {
		display: grid;
		grid-template-columns: 5.5rem 1fr 1fr;
		align-items: end;
		gap: 0.5rem;
	}

	.help {
		font-size: 0.9rem;
		margin: 0 0 0.25rem;
	}

	.nutrition {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem 0.5rem;
	}

	.actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
</style>
