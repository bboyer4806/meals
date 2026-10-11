<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { formatDateLabel } from '../dates.ts';
	import { addDays, isDate } from '../menu.ts';
	import Sheet from './Sheet.svelte';

	// Move to another date (design 2.2.2): "we didn't make Tuesday's dinner, let's do it
	// Wednesday", so the next day is filled in. A dinner already on that date swaps places with
	// this one. The page then opens the new date.
	let {
		date,
		dinnerId,
		canLeave,
		keepAsking,
		onlost
	}: {
		date: string;
		/** The dinner the page shows, so the move doesn't take another one. */
		dinnerId: number;
		/** Asks about anything unsaved that opening the new date would drop; false to stay. */
		canLeave: () => boolean;
		/** Says the move didn't happen, so leaving later asks about it again. */
		keepAsking: () => void;
		/**
		 * Shows a failure on the page instead, when the reload after it took Move off the page
		 * (someone cleared the dinner meanwhile).
		 */
		onlost: (message: string) => void;
	} = $props();

	const uid = $props.id();
	let open = $state(false);
	let to = $state('');
	let busy = $state(false);
	let problem = $state('');

	// Set once Move is off the page.
	let removed = false;
	onDestroy(() => (removed = true));

	function show() {
		to = addDays(date, 1);
		problem = '';
		open = true;
	}

	const submit: SubmitFunction = ({ cancel }) => {
		// Moving opens the new date, so anything unsaved is asked about before the dinner moves.
		if (busy || !canLeave()) return cancel();
		busy = true;
		problem = '';
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure' || (result.type === 'error' && result.status === 404)) {
					problem =
						result.type === 'failure'
							? ((result.data as { error?: string } | undefined)?.error ??
								'Something went wrong. Please try again.')
							: 'This dinner is no longer on the menu.';
					// Shows the date as it is now, such as another dinner someone moved onto it.
					await refreshAll();
					await tick();
					if (removed) onlost(problem);
					return;
				}
				if (result.type === 'redirect') open = false;
				await update();
			} finally {
				busy = false;
				// The dinner didn't move, so what's typed on the page is still worth asking about.
				if (result.type !== 'redirect') keepAsking();
			}
		};
	};
</script>

<button type="button" onclick={show}>Move to another date</button>

<Sheet bind:open title="Move to another date">
	<form method="POST" action="?/move" use:enhance={submit}>
		<input type="hidden" name="dinnerId" value={dinnerId} />
		<div class="field">
			<label for="{uid}-to">New date</label>
			<input id="{uid}-to" name="to" type="date" required bind:value={to} />
		</div>
		<p class="muted">If that date already has a dinner, the two swap places.</p>
		{#if problem}<p class="error" role="alert">{problem}</p>{/if}
		<div class="row">
			<button class="primary">{isDate(to) ? `Move to ${formatDateLabel(to)}` : 'Move'}</button>
			<button type="button" onclick={() => (open = false)}>Cancel</button>
		</div>
	</form>
</Sheet>
