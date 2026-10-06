<script lang="ts" module>
	/** What saving the recipe does to its photo. */
	export type PhotoChoice =
		| { kind: 'keep' }
		| { kind: 'new'; photo: Blob; thumb: Blob; preview: string }
		| { kind: 'remove' };
</script>

<script lang="ts">
	import { resizePhoto } from '../photo-resize.ts';

	// A recipe's photo in the editor: take or choose one, resized on the phone before it's sent
	// (design 2.3), with a preview. Nothing changes until the recipe is saved. `busy` is true while
	// a photo is being resized, so the form can wait for it.
	let {
		savedKey,
		choice = $bindable({ kind: 'keep' }),
		busy = $bindable(false)
	}: { savedKey: string | null; choice?: PhotoChoice; busy?: boolean } = $props();

	let input: HTMLInputElement;
	let pickButton: HTMLButtonElement;
	let problem = $state('');
	// Only the latest pick counts, if someone picks again while one is still being resized.
	let picks = 0;

	const shown = $derived.by(() => {
		if (choice.kind === 'new') return choice.preview;
		if (choice.kind === 'keep' && savedKey !== null) return `/photos/${savedKey}-thumb.jpg`;
		return null;
	});

	async function picked() {
		const file = input.files?.[0];
		// Cleared, so choosing the same file again still counts as a change.
		input.value = '';
		if (!file) return;
		const pick = ++picks;
		busy = true;
		problem = '';
		try {
			const resized = await resizePhoto(file);
			if (pick === picks) choice = { kind: 'new', ...resized };
		} catch (e) {
			if (pick === picks) {
				problem = e instanceof Error ? e.message : "This photo couldn't be read. Try a JPEG or PNG.";
			}
		} finally {
			if (pick === picks) busy = false;
		}
	}

	function remove() {
		// Also drops a photo that's still being resized.
		picks += 1;
		busy = false;
		problem = '';
		choice = savedKey === null ? { kind: 'keep' } : { kind: 'remove' };
		pickButton.focus();
	}

	function keep() {
		choice = { kind: 'keep' };
		pickButton.focus();
	}
</script>

<div class="photo">
	{#if shown}
		<img src={shown} alt="" width="96" height="96" />
	{:else}
		<span class="empty" aria-hidden="true"></span>
	{/if}
	<div class="buttons">
		<!-- Opened by the button. Hidden this way rather than with display: none, which some phone
		browsers won't open a file picker for. -->
		<input
			bind:this={input}
			class="visually-hidden"
			type="file"
			accept="image/*"
			tabindex="-1"
			aria-hidden="true"
			onchange={picked}
		/>
		<button type="button" bind:this={pickButton} onclick={() => input.click()}>
			{shown ? 'Change photo' : 'Add photo'}
		</button>
		{#if shown || busy}
			<button type="button" class="quiet" onclick={remove}>Remove photo</button>
		{:else if choice.kind === 'remove'}
			<button type="button" class="quiet" onclick={keep}>
				Keep the old photo
			</button>
		{/if}
	</div>
</div>
{#if busy}
	<p class="muted note" role="status">Getting the photo ready…</p>
{:else if choice.kind === 'remove'}
	<p class="muted note">The photo is removed when you save.</p>
{/if}
{#if problem}<p class="error note" role="alert">{problem}</p>{/if}

<style>
	.photo {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	img,
	.empty {
		flex: none;
		width: 96px;
		height: 96px;
		border-radius: var(--radius);
		object-fit: cover;
		background: var(--surface-sunk);
	}

	.empty {
		border: 2px dashed var(--border);
	}

	.buttons {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
		min-width: 0;
	}

	.note {
		margin: 0.5rem 0 0;
	}
</style>
