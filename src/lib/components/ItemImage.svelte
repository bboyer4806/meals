<script lang="ts" module>
	/** What saving the item does to its image. */
	export type ImageChoice =
		| { kind: 'keep' }
		| { kind: 'new'; photo: Blob; thumb: Blob; preview: string }
		| { kind: 'remove' };
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { resizePhoto } from '../photo-resize.ts';

	// An item's image in the Items page's edit sheet (design 7, Item images): one from the device,
	// or the one a link points at, which the server downloads (4.5). Either way the phone resizes
	// it, as it does a recipe's photo (2.3), and shows it before it's saved. Nothing changes until
	// the item is saved. `busy` is true while an image is on its way, so the sheet can wait for it.
	let {
		savedKey,
		choice = $bindable({ kind: 'keep' }),
		busy = $bindable(false)
	}: { savedKey: string | null; choice?: ImageChoice; busy?: boolean } = $props();

	const UNREADABLE = "This image couldn't be read. Try a JPEG or PNG.";

	let input: HTMLInputElement;
	let pickButton: HTMLButtonElement;
	let link = $state('');
	let problem = $state('');
	// Only the latest image counts, if another is picked or linked while one is on its way.
	let picks = 0;
	// The sheet rebuilds this for each item it opens, so an image still on its way for the item
	// before is dropped rather than shown, and saved, with the next one.
	onDestroy(() => (picks += 1));

	// Getting the image a link points at needs the page's script.
	let ready = $state(false);
	onMount(() => (ready = true));

	const shown = $derived.by(() => {
		if (choice.kind === 'new') return choice.preview;
		if (choice.kind === 'keep' && savedKey !== null) return `/photos/${savedKey}-thumb.jpg`;
		return null;
	});

	/** Starts on a new image, dropping one still on its way, and gives its number. */
	function start(): number {
		busy = true;
		problem = '';
		return ++picks;
	}

	/** Resizes the image and shows it, unless another came since. Gives whether it did. */
	async function use(image: File, pick: number): Promise<boolean> {
		try {
			const resized = await resizePhoto(image);
			if (pick !== picks) return false;
			choice = { kind: 'new', ...resized };
			return true;
		} catch {
			if (pick === picks) problem = UNREADABLE;
			return false;
		} finally {
			if (pick === picks) busy = false;
		}
	}

	function picked() {
		const file = input.files?.[0];
		// Cleared, so choosing the same file again still counts as a change.
		input.value = '';
		if (file) void use(file, start());
	}

	const getImage: SubmitFunction = ({ cancel }) => {
		if (busy) return cancel();
		const pick = start();
		return async ({ result, update }) => {
			if (pick !== picks) return;
			if (result.type === 'success') {
				const { image } = result.data as { image: Uint8Array<ArrayBuffer> };
				// The link is done with once its image shows.
				if (await use(new File([image], 'image'), pick)) link = '';
				return;
			}
			busy = false;
			if (result.type === 'failure') {
				problem = (result.data as { error: string }).error;
			} else if (result.type === 'redirect') {
				// Signed out.
				await update();
			} else {
				problem = "Couldn't get the image. Check your connection and try again.";
			}
		};
	};

	function remove() {
		// Also drops an image that's still on its way.
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

<div class="field" role="group" aria-labelledby="item-image-label">
	<span class="label" id="item-image-label">Image</span>
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
	<form class="link" method="POST" action="?/image" use:enhance={getImage}>
		<label for="item-image-link">Image link</label>
		<div class="row">
			<input
				class="grow"
				id="item-image-link"
				name="link"
				type="url"
				required
				maxlength="2000"
				autocomplete="off"
				bind:value={link}
			/>
			<button disabled={!ready || busy}>Get image</button>
		</div>
	</form>
	{#if busy}
		<p class="muted note" role="status">Getting the image ready…</p>
	{:else if choice.kind === 'remove'}
		<p class="muted note">The image is removed when you save.</p>
	{/if}
	{#if problem}<p class="error note" role="alert">{problem}</p>{/if}
</div>

<style>
	.label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

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

	.link {
		margin-top: 0.75rem;
	}

	.note {
		margin: 0.5rem 0 0;
	}
</style>
