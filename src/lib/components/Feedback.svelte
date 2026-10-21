<script lang="ts">
	import { applyAction, enhance, type SubmitFunction } from '$app/forms';
	import { page } from '$app/state';
	import { MAX_FEEDBACK } from '../feedback.ts';
	import Sheet from './Sheet.svelte';

	// The feedback button at the bottom right of every signed-in page and its sheet (design 7,
	// "Feedback"). Sending makes a Jira ticket and nothing else: the page behind isn't reloaded,
	// so anything typed there and not saved, such as a dinner's note, stays (6.9).

	const uid = $props.id();
	const NOT_SENT = "Couldn't send your feedback. Try again.";
	const limit = MAX_FEEDBACK.toLocaleString('en-US');

	let open = $state(false);
	let message = $state('');
	let sending = $state(false);
	let sent = $state(false);
	let problem = $state('');

	function show() {
		// A new message after one was sent; one that failed stays to send again.
		if (sent) message = '';
		sent = false;
		problem = '';
		open = true;
	}

	const submit: SubmitFunction = ({ formData, cancel }) => {
		if (sending) return cancel();
		sending = true;
		problem = '';
		formData.set('page', page.url.pathname + page.url.search);
		formData.set('width', String(window.innerWidth));
		formData.set('height', String(window.innerHeight));
		// Skips the default update, which would reload the page's data.
		return async ({ result }) => {
			sending = false;
			if (result.type === 'success') sent = true;
			else if (result.type === 'failure')
				problem = (result.data as { error?: string } | undefined)?.error ?? NOT_SENT;
			else if (result.type === 'redirect') await applyAction(result);
			else problem = NOT_SENT;
		};
	};
</script>

<button type="button" class="feedback no-print" aria-label="Send feedback"
	data-tour="feedback"
	onclick={show}>
	<svg viewBox="0 0 24 24" aria-hidden="true">
		<path d="M4 5h16v11H9l-5 4z" />
		<path d="M8 9h8M8 12h5" />
	</svg>
</button>

<Sheet bind:open title="Send feedback">
	{#if sent}
		<p>Thanks, your feedback was sent.</p>
		<button type="button" class="wide" onclick={() => (open = false)}>Close</button>
	{:else}
		<form method="POST" action="/feedback" use:enhance={submit}>
			<label for="{uid}-message">Feedback</label>
			<textarea
				id="{uid}-message"
				name="message"
				rows="6"
				maxlength={MAX_FEEDBACK}
				aria-describedby="{uid}-count"
				bind:value={message}
			></textarea>
			<div class="count" id="{uid}-count">
				{#if message.length >= MAX_FEEDBACK}
					<span class="limit">You've reached the {limit}-character limit.</span>
				{/if}
				<span class="muted">{message.length.toLocaleString('en-US')} / {limit}</span>
			</div>
			{#if problem}<p class="error" role="alert">{problem}</p>{/if}
			<button class="primary wide" disabled={sending}>{sending ? 'Sending…' : 'Send'}</button>
		</form>
	{/if}
</Sheet>

<style>
	/* Just above the tab bar, which the layout gives the same height. */
	.feedback {
		position: fixed;
		right: 1rem;
		bottom: calc(var(--tabs-height) + 0.75rem + env(safe-area-inset-bottom));
		z-index: 20;
		width: var(--feedback-size);
		height: var(--feedback-size);
		padding: 0;
		border-radius: 50%;
		color: var(--accent);
		box-shadow: var(--shadow);
	}

	.feedback svg {
		width: 24px;
		height: 24px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.count {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
		margin: 0.25rem 0 1rem;
	}

	.count .muted {
		margin-left: auto;
		white-space: nowrap;
	}

	.limit {
		color: var(--ordered);
		font-weight: 700;
	}

	.wide {
		width: 100%;
	}
</style>
