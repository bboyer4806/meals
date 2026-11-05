<script lang="ts" module>
	/** What saving the item does to its image, apart from a link, which is a field of its own. */
	export type ImageChoice =
		| { kind: 'keep' }
		| { kind: 'new'; photo: Blob; thumb: Blob; preview: string }
		| { kind: 'remove' };
</script>

<script lang="ts">
	import { resizePhoto } from '../photo-resize.ts';

	// An item's image in the Items sheet (MEA-50; design 7, Items): one picked on the device,
	// resized there before it's sent (design 2.3), or a link the server downloads when the item is
	// saved. Picking or removing an image clears the link, and typing a link drops an image picked
	// or removed before it, so saving sends one change at most. Nothing changes until Save. `busy`
	// is true while a picked image is being resized, so the sheet can wait for it.
	let {
		savedKey,
		choice = $bindable({ kind: 'keep' }),
		busy = $bindable(false)
	}: { savedKey: string | null; choice?: ImageChoice; busy?: boolean } = $props();

	const uid = $props.id();
	let input: HTMLInputElement;
	let pickButton: HTMLButtonElement;
	let problem = $state('');
	// Sent by its own field, photoLink.
	let link = $state('');
	// Only the latest pick counts, if someone picks again while one is still being resized.
	let picks = 0;

	const shown = $derived.by(() => {
		if (choice.kind === 'new') return choice.preview;
		if (choice.kind === 'keep' && savedKey !== null) return `/photos/${savedKey}-thumb.jpg`;
		return null;
	});
	const linked = $derived(link.trim() !== '');

	/** Drops an image still being resized, and what its pick said. */
	function stopPicking() {
		picks += 1;
		busy = false;
		problem = '';
	}

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
			if (pick === picks) {
				choice = { kind: 'new', ...resized };
				link = '';
			}
		} catch {
			if (pick === picks) problem = "This image couldn't be read. Try a JPEG or PNG.";
		} finally {
			if (pick === picks) busy = false;
		}
	}

	function remove() {
		stopPicking();
		link = '';
		choice = savedKey === null ? { kind: 'keep' } : { kind: 'remove' };
		pickButton.focus();
	}

	function keep() {
		choice = { kind: 'keep' };
		pickButton.focus();
	}

	function typed(event: Event & { currentTarget: HTMLInputElement }) {
		if (event.currentTarget.value.trim() === '') return;
		stopPicking();
		choice = { kind: 'keep' };
	}
</script>

<div class="image">
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
			{shown ? 'Change image' : 'Add image'}
		</button>
		{#if shown || busy}
			<button type="button" class="quiet" onclick={remove}>Remove image</button>
		{:else if choice.kind === 'remove'}
			<button type="button" class="quiet" onclick={keep}>Keep the old image</button>
		{/if}
	</div>
</div>
{#if busy}
	<p class="muted note" role="status">Getting the image ready…</p>
{:else if choice.kind === 'remove'}
	<p class="muted note">The image is removed when you save.</p>
{/if}
{#if problem}<p class="error note" role="alert">{problem}</p>{/if}

<div class="link">
	<label for="{uid}-link">Image link</label>
	<input
		id="{uid}-link"
		name="photoLink"
		type="url"
		inputmode="url"
		maxlength="500"
		autocomplete="off"
		placeholder="https://"
		aria-describedby="{uid}-link-help"
		bind:value={link}
		oninput={typed}
	/>
	<p class="muted note" id="{uid}-link-help">
		{linked
			? 'Saving downloads the image from this link and uses it.'
			: 'Or paste a link to an image on the web.'}
	</p>
</div>

<style>
	.image {
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
		font-size: 0.9rem;
	}

	.link {
		margin-top: 0.75rem;
	}
</style>
