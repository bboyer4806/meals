<script lang="ts">
	import type { Snippet } from 'svelte';

	// A panel that slides up from the bottom on phones and is centered on wider screens.
	// Its content stays in the page while closed, so buttons inside a form still submit it.
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
	dialog {
		border: none;
		padding: 0;
		margin: auto auto 0;
		width: 100%;
		max-width: 40rem;
		max-height: 88vh;
		border-radius: 18px 18px 0 0;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow);
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

	.content {
		padding: 0.75rem 1rem calc(1.25rem + env(safe-area-inset-bottom));
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
