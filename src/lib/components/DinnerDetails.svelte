<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { beforeNavigate, refreshAll } from '$app/navigation';
	import { DINNER_NOTE_MAX, hasDishes, type DinnerType } from '../menu.ts';
	import { MAX_SERVINGS } from '../recipe-view.ts';
	import type { Dinner } from '../server/data/dinners.ts';

	// A dinner's servings (types with dishes; Q28) and note (all types; Q26), saved together.
	let {
		dinner,
		servings = $bindable(null)
	}: {
		dinner: Dinner;
		/**
		 * The servings on screen, saved or not, which the dish links use. A number field bound
		 * with bind:value holds a number, or null while it's empty.
		 */
		servings?: number | null;
	} = $props();

	const uid = $props.id();
	const withServings = $derived(hasDishes(dinner.type));

	const NOTE_HINTS: Record<DinnerType, string> = {
		cook: 'Anything to remember',
		eat_out: 'Where to go',
		going: 'Where, and what to bring',
		leftovers: 'Which leftovers'
	};

	// Copied from the saved dinner, and kept in step with it while unchanged here, so a reload
	// shows someone else's change (Q11) without dropping what's being typed.
	let note = $state(untrack(() => dinner.note ?? ''));
	servings = untrack(() => dinner.servings);
	let savedNote = untrack(() => dinner.note ?? '');
	let savedServings = untrack(() => dinner.servings);
	$effect(() => {
		const nextNote = dinner.note ?? '';
		const nextServings = dinner.servings;
		untrack(() => {
			if (note === savedNote) note = nextNote;
			if (servings === savedServings) servings = nextServings;
			savedNote = nextNote;
			savedServings = nextServings;
		});
	});

	// What saving would change, or null when nothing would: the note as it's stored, and the
	// servings while they show. An emptied servings field has nothing to keep.
	function unsaved(): string | null {
		const typedNote = note.replace(/\r\n?/g, '\n').trim();
		const typedServings = withServings && servings !== null ? servings : savedServings;
		if (typedNote === savedNote && typedServings === savedServings) return null;
		return JSON.stringify([typedNote, typedServings]);
	}

	const LEAVE = 'Leave without saving? What you typed will be lost.';
	// What the person agreed to lose, so going on with it doesn't ask again.
	let dropped: string | null = null;

	/**
	 * Asks before something drops what's typed here, as moving the dinner does. True when nothing
	 * is lost or the person agreed.
	 */
	export function confirmLeave(): boolean {
		const typed = unsaved();
		if (typed === null || typed === dropped) return true;
		if (!confirm(LEAVE)) return false;
		dropped = typed;
		return true;
	}

	/** Takes back confirmLeave's agreement when what it was for didn't happen. */
	export function keepAsking(): void {
		dropped = null;
	}

	/** Whether something typed here would be lost, and the person hasn't agreed to lose it. */
	export function hasUnsaved(): boolean {
		const typed = unsaved();
		return typed !== null && typed !== dropped;
	}

	beforeNavigate((navigation) => {
		if (navigation.type !== 'leave') {
			if (!confirmLeave()) navigation.cancel();
			return;
		}
		// Closing the tab or leaving the site: the browser asks.
		if (hasUnsaved()) navigation.cancel();
	});

	let busy = $state(false);
	let problem = $state('');
	let status = $state('');

	let fewerButton = $state<HTMLButtonElement>();
	let moreButton = $state<HTMLButtonElement>();

	function step(by: number) {
		const next = Math.min(MAX_SERVINGS, Math.max(1, Math.round((servings ?? savedServings) + by)));
		servings = next;
		status = '';
		// The button that reached its limit is disabled, which would drop focus to the page.
		if (next <= 1) moreButton?.focus();
		else if (next >= MAX_SERVINGS) fewerButton?.focus();
	}

	const submit: SubmitFunction = ({ cancel, formElement }) => {
		if (busy) return cancel();
		busy = true;
		problem = '';
		status = '';
		const sent = { note, servings };
		// SvelteKit moves focus to the top of the page after a form succeeds; Save (or the field
		// Enter was pressed in) keeps it.
		const focused = formElement.contains(document.activeElement) ? document.activeElement : null;
		return async ({ result, update }) => {
			try {
				// Servings or a note that can't be saved fail, and so does a save meant for another
				// dinner than the one now on the date. What was typed stays here for another try, with
				// the dinner as it is now.
				if (result.type === 'failure') {
					problem =
						(result.data as { error?: string } | undefined)?.error ??
						'Something went wrong. Please try again.';
					await refreshAll();
					return;
				}
				await update({ reset: false });
				if (result.type !== 'success') return;
				// Shows what was saved (the note trimmed), unless more was typed meanwhile.
				if (note === sent.note) note = dinner.note ?? '';
				if (servings === sent.servings) servings = dinner.servings;
				status = (result.data as { replanned?: boolean } | undefined)?.replanned
					? 'Someone had cleared or moved this dinner, so it was planned again with what you saved.'
					: 'Saved';
				if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
			} finally {
				busy = false;
			}
		};
	};
</script>

<form class="card" method="POST" action="?/details" use:enhance={submit}>
	<input type="hidden" name="dinnerId" value={dinner.id} />
	<input type="hidden" name="type" value={dinner.type} />
	{#if withServings}
		<div class="field">
			<label for="{uid}-servings">Servings</label>
			<div class="servings">
				<button
					type="button"
					class="adjust"
					aria-label="Fewer servings"
					bind:this={fewerButton}
					disabled={servings !== null && servings <= 1}
					onclick={() => step(-1)}>−</button
				>
				<input
					id="{uid}-servings"
					name="servings"
					type="number"
					inputmode="numeric"
					min="1"
					max={MAX_SERVINGS}
					step="1"
					required
					bind:value={servings}
					oninput={() => (status = '')}
				/>
				<button
					type="button"
					class="adjust"
					aria-label="More servings"
					bind:this={moreButton}
					disabled={servings !== null && servings >= MAX_SERVINGS}
					onclick={() => step(1)}>+</button
				>
			</div>
		</div>
	{/if}
	<div class="field">
		<label for="{uid}-note">Note</label>
		<textarea
			id="{uid}-note"
			name="note"
			rows="3"
			maxlength={DINNER_NOTE_MAX}
			placeholder={NOTE_HINTS[dinner.type]}
			bind:value={note}
			oninput={() => (status = '')}
		></textarea>
	</div>
	{#if problem}<p class="error" role="alert">{problem}</p>{/if}
	<div class="row">
		<button class="primary">Save</button>
		<span class="muted" role="status">{status}</span>
	</div>
</form>

<style>
	.servings {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.servings input {
		width: 5rem;
		text-align: center;
	}

	.adjust {
		width: var(--tap);
		padding: 0;
		border-radius: 50%;
		font-size: 1.4rem;
		line-height: 1;
	}
</style>
