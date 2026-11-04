<script lang="ts">
	import { applyAction, enhance, type SubmitFunction } from '$app/forms';
	import { page } from '$app/state';
	import { MAX_FEEDBACK, screenshotType } from '../feedback.ts';
	import { dataUrl } from '../photo-resize.ts';
	import Sheet from './Sheet.svelte';

	// The feedback button at the bottom right of every signed-in page and its sheet (design 7,
	// "Feedback"). Sending makes a Jira ticket and nothing else: the page behind isn't reloaded,
	// so anything typed there and not saved, such as a dinner's note, stays (6.9).

	const uid = $props.id();
	const NOT_SENT = "Couldn't send your feedback. Try again.";
	const limit = MAX_FEEDBACK.toLocaleString('en-US');

	let open = $state(false);
	let message = $state('');
	// The PNG or JPEG to send with the message, and the thumbnail that shows it.
	let screenshot = $state<{ file: File; preview: string } | null>(null);
	// The ticket already created for a message whose screenshot wasn't attached, to attach it to.
	let retry = $state<{ token: string; message: string } | null>(null);
	let sending = $state(false);
	let sent = $state(false);
	let problem = $state('');
	let fileInput = $state<HTMLInputElement>();
	let pickButton = $state<HTMLButtonElement>();

	function show() {
		// A new message after one was sent; one that failed stays to send again, with its
		// screenshot.
		if (sent) {
			message = '';
			screenshot = null;
			retry = null;
		}
		sent = false;
		problem = '';
		open = true;
	}

	async function picked(event: Event & { currentTarget: HTMLInputElement }) {
		const file = event.currentTarget.files?.[0];
		// Cleared, so choosing the same file again still counts as a pick.
		event.currentTarget.value = '';
		if (!file) return;
		const checked = await screenshotType(file);
		// The screenshot already chosen, if any, stays.
		if ('problem' in checked) {
			problem = checked.problem;
			return;
		}
		problem = '';
		// As the type its content shows, which its name or stated type may not.
		screenshot = { file, preview: await dataUrl(new Blob([file], { type: checked.type })) };
	}

	function remove() {
		screenshot = null;
		problem = '';
		pickButton?.focus();
	}

	const submit: SubmitFunction = ({ formData, cancel }) => {
		if (sending) return cancel();
		sending = true;
		problem = '';
		formData.set('page', page.url.pathname + page.url.search);
		formData.set('width', String(window.innerWidth));
		formData.set('height', String(window.innerHeight));
		if (screenshot) formData.set('screenshot', screenshot.file);
		// Only for the same message: a changed one is sent as new feedback.
		const sentMessage = message;
		if (retry?.message === sentMessage) formData.set('retry', retry.token);
		// Skips the default update, which would reload the page's data.
		return async ({ result }) => {
			sending = false;
			if (result.type === 'success') sent = true;
			else if (result.type === 'failure') {
				const data = result.data as { error?: string; retry?: string } | undefined;
				problem = data?.error ?? NOT_SENT;
				retry = data?.retry ? { token: data.retry, message: sentMessage } : null;
			} else if (result.type === 'redirect') await applyAction(result);
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
		<form method="POST" action="/feedback" enctype="multipart/form-data" use:enhance={submit}>
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
			<div class="field" role="group" aria-labelledby="{uid}-screenshot">
				<span class="label" id="{uid}-screenshot">Screenshot (optional)</span>
				<div class="screenshot">
					{#if screenshot}
						<img src={screenshot.preview} alt="Your screenshot" width="96" height="96" />
					{/if}
					<div class="buttons">
						<!-- Opened by the button. Hidden this way rather than with display: none, which
						some phone browsers won't open a file picker for. -->
						<input
							bind:this={fileInput}
							class="visually-hidden"
							type="file"
							accept="image/png,image/jpeg"
							tabindex="-1"
							aria-hidden="true"
							onchange={picked}
						/>
						<button type="button" bind:this={pickButton} onclick={() => fileInput?.click()}>
							{screenshot ? 'Replace' : 'Add screenshot'}
						</button>
						{#if screenshot}
							<button type="button" class="quiet" onclick={remove}>Remove</button>
						{/if}
					</div>
				</div>
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

	.label {
		display: block;
		font-weight: 600;
		margin-bottom: 0.25rem;
	}

	.screenshot {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	/* Whole, as a phone's tall screenshot or a computer's wide one. */
	img {
		flex: none;
		width: 96px;
		height: 96px;
		border-radius: var(--radius);
		object-fit: contain;
		background: var(--surface-sunk);
	}

	.buttons {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.25rem;
	}

	.wide {
		width: 100%;
	}
</style>
