<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { beforeNavigate, refreshAll } from '$app/navigation';
	import { DINNER_LABEL_MAX, DINNER_NOTE_MAX, hasDishes, type DinnerType } from '../menu.ts';
	import { MAX_SERVINGS } from '../recipe-view.ts';
	import type { Dinner } from '../server/data/dinners.ts';
	import { normalizeName } from '../text.ts';

	// A dinner's servings (types with dishes; Q28) and note (all types; Q26), saved together, and
	// its label on a date with more than one dinner (6.9).
	let {
		dinner,
		labeled,
		servings = $bindable(null)
	}: {
		/** A saved dinner, or with no id the Cooking at home a date with no dinner shows (6.9). */
		dinner: Pick<Dinner, 'label' | 'type' | 'note' | 'servings'> & { id: number | null };
		/** Whether the date has more than one dinner, so this one has a label. */
		labeled: boolean;
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
	let label = $state(untrack(() => dinner.label ?? ''));
	servings = untrack(() => dinner.servings);
	let savedNote = untrack(() => dinner.note ?? '');
	let savedLabel = untrack(() => dinner.label ?? '');
	let savedServings = untrack(() => dinner.servings);
	$effect(() => {
		const nextNote = dinner.note ?? '';
		const nextLabel = dinner.label ?? '';
		const nextServings = dinner.servings;
		untrack(() => {
			if (note === savedNote) note = nextNote;
			if (label === savedLabel) label = nextLabel;
			if (servings === savedServings) servings = nextServings;
			savedNote = nextNote;
			savedLabel = nextLabel;
			savedServings = nextServings;
		});
	});

	/** The label as typed, as it would be stored, while it shows. */
	function typedLabel(): string {
		return labeled ? normalizeName(label) : savedLabel;
	}

	// What saving would change, or null when nothing would: the note as it's stored, and the
	// servings and label while they show. An emptied servings field has nothing to keep.
	function unsaved(): string | null {
		const typedServings = withServings && servings !== null ? servings : savedServings;
		const typed = [typedNote(), typedServings, typedLabel()];
		if (typed[0] === savedNote && typedServings === savedServings && typed[2] === savedLabel) {
			return null;
		}
		return JSON.stringify(typed);
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

	/** The note as typed, as it would be stored. */
	export function typedNote(): string {
		return note.replace(/\r\n?/g, '\n').trim();
	}

	/** Whether what's typed here is what another dinner already has saved. */
	export function matches(other: Dinner): boolean {
		const typedServings = withServings && servings !== null ? servings : other.servings;
		return (
			typedNote() === (other.note ?? '') &&
			typedServings === other.servings &&
			(!labeled || typedLabel() === (other.label ?? ''))
		);
	}

	/** Shows the saved dinner again, dropping what was typed. */
	export function reset(): void {
		note = dinner.note ?? '';
		label = dinner.label ?? '';
		servings = dinner.servings;
		savedNote = note;
		savedLabel = label;
		savedServings = dinner.servings;
		dropped = null;
		problem = '';
		status = '';
	}

	/** Whether something typed here would be lost, and the person hasn't agreed to lose it. */
	export function hasUnsaved(): boolean {
		const typed = unsaved();
		return typed !== null && typed !== dropped;
	}

	// Set when the person goes elsewhere while a save is on its way, so the save leaves them there.
	let leftWhileBusy = false;

	beforeNavigate((navigation) => {
		if (navigation.type !== 'leave') {
			if (!confirmLeave()) return navigation.cancel();
			if (busy) leftWhileBusy = true;
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
		leftWhileBusy = false;
		problem = '';
		status = '';
		const sent = { note, servings, label };
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
				// Saved, so it goes to the week. The page doesn't reload before it leaves, so what was
				// sent is marked saved here, or leaving would ask about it. Any other redirect, such as
				// to sign in again, saved nothing, so leaving still asks.
				const saved =
					result.type === 'redirect' &&
					new URL(result.location, location.href).searchParams.has('saved');
				if (saved) {
					if (leftWhileBusy) return;
					savedNote = sent.note.replace(/\r\n?/g, '\n').trim();
					if (withServings && sent.servings !== null) savedServings = sent.servings;
					if (labeled) savedLabel = normalizeName(sent.label);
				}
				await update({ reset: false });
				// Still here after a save: more was typed meanwhile, and the person chose to stay with it.
				if (saved) status = 'Saved';
				if (result.type !== 'success') return;
				// Someone had cleared or moved the dinner, so the save planned the date again, and the
				// page stays to say so. It shows what was saved (the note trimmed), unless more was
				// typed meanwhile.
				if (note === sent.note) note = dinner.note ?? '';
				if (servings === sent.servings) servings = dinner.servings;
				if (label === sent.label) label = dinner.label ?? '';
				status =
					'Someone had cleared or moved this dinner, so it was planned again with what you saved.';
				if (focused instanceof HTMLElement && focused.isConnected) focused.focus();
			} finally {
				busy = false;
			}
		};
	};
</script>

<form class="card" method="POST" action="?/details" use:enhance={submit}>
	{#if dinner.id !== null}<input type="hidden" name="dinnerId" value={dinner.id} />{/if}
	<input type="hidden" name="type" value={dinner.type} />
	{#if labeled}
		<div class="field">
			<label for="{uid}-label">Label</label>
			<input
				id="{uid}-label"
				name="label"
				autocomplete="off"
				maxlength={DINNER_LABEL_MAX}
				placeholder="Such as Kids or Adults"
				bind:value={label}
				oninput={() => (status = '')}
			/>
		</div>
	{/if}
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
