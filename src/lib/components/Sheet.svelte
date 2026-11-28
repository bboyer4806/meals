<script lang="ts">
	import type { Snippet } from 'svelte';

	// A panel that slides up from the bottom on phones and is centered on wider screens.
	// Its content stays in the page while closed, so buttons inside a form still submit it.
	// It keeps to the part of the window on screen, the visual viewport. A phone's keyboard
	// covers the bottom of the window, shortening the visual viewport, and leaves the page under
	// it, so the sheet sits just above the keyboard and takes only the room above it, with what
	// doesn't fit scrolling. Its buttons can then be tapped with the keyboard open (design 8,
	// MEA-277).
	let {
		open = $bindable(false),
		title,
		children
	}: { open?: boolean; title: string; children: Snippet } = $props();

	const titleId = $props.id();
	let dialog: HTMLDialogElement;

	$effect(() => {
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	// The pixels left between the field being typed in and a phone's keyboard, as ItemInput leaves
	// between the dish suggestions and the keyboard (MEA-265).
	const KEYBOARD_GAP = 8;

	/**
	 * Gives the sheet the visual viewport's top and height, measured from the top of the window.
	 * A sheet made shorter no longer shows what's at its bottom, so it then scrolls just far enough
	 * to show the field being typed in, if that's where the field is.
	 */
	function fit() {
		const viewport = window.visualViewport!;
		dialog.style.setProperty('--visible-top', `${viewport.offsetTop}px`);
		dialog.style.setProperty('--visible-height', `${viewport.height}px`);
		const field = document.activeElement;
		if (field === null || !dialog.contains(field)) return;
		const hidden =
			field.getBoundingClientRect().bottom + KEYBOARD_GAP - dialog.getBoundingClientRect().bottom;
		if (hidden > 0) dialog.scrollTop += hidden;
	}

	// As the sheet opens, and while it's open, as the keyboard opens, closes or changes size, and as
	// the browser moves the visual viewport within the window, such as to show a focused field.
	$effect(() => {
		if (!open) return;
		fit();
		const viewport = window.visualViewport!;
		viewport.addEventListener('resize', fit);
		viewport.addEventListener('scroll', fit);
		return () => {
			viewport.removeEventListener('resize', fit);
			viewport.removeEventListener('scroll', fit);
		};
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby={titleId}
	onclose={() => (open = false)}
	onclick={(event) => {
		// A click on the dialog itself, rather than its content, is a click on the backdrop.
		if (event.target === dialog) open = false;
	}}
>
	<div class="content">
		<header>
			<h2 id={titleId}>{title}</h2>
			<button type="button" class="quiet" aria-label="Close" onclick={() => (open = false)}>
				✕
			</button>
		</header>
		{@render children()}
	</div>
</dialog>

<style>
	/* In the visual viewport, as fit measures it, and no taller than 88% of it (MEA-277). */
	dialog {
		border: none;
		padding: 0;
		top: var(--visible-top);
		bottom: calc(100% - var(--visible-top) - var(--visible-height));
		margin: auto auto 0;
		width: 100%;
		max-width: 40rem;
		max-height: calc(0.88 * var(--visible-height));
		border-radius: 18px 18px 0 0;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow);
		/* Dragging past the end of a long sheet doesn't carry on to the page behind (design 8). */
		overscroll-behavior: contain;
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 0.45);
	}

	@media (min-width: 42rem) {
		dialog {
			margin: auto;
			border-radius: 18px;
		}
	}

	@media (max-width: 41.99rem) and (prefers-reduced-motion: no-preference) {
		dialog[open] {
			animation: slide-up 0.2s ease-out;
		}
	}

	@keyframes slide-up {
		from {
			transform: translateY(100%);
		}
	}

	/* A long name without spaces, such as a dish's, wraps rather than widening the sheet past
	   the screen. The title inherits it. */
	.content {
		padding: 0.75rem 1rem calc(1.25rem + env(safe-area-inset-bottom));
		overflow-wrap: anywhere;
	}

	header button {
		min-width: var(--tap);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	h2 {
		margin: 0;
	}
</style>
