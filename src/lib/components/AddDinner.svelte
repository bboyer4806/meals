<script lang="ts">
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { DINNER_LABEL_MAX } from '../menu.ts';
	import Sheet from './Sheet.svelte';

	// Add a dinner (design 6.9, 7): another dinner on a planned date, such as one for the kids and
	// one for the adults. Every dinner on a date with more than one has a label, so the second
	// asks for both labels at once: the first dinner's and the new one's.
	let {
		count,
		ownUpdate,
		onadded
	}: {
		/** How many dinners the date has now. */
		count: number;
		/** Reloads the page after the dinner is added, keeping what's typed in the others. */
		ownUpdate: (result: ActionResult, update: () => Promise<void>) => Promise<void>;
		/** After the new dinner shows. */
		onadded: () => void;
	} = $props();

	const uid = $props.id();
	let open = $state(false);
	let busy = $state(false);
	let problem = $state('');
	let first = $state('');
	let label = $state('');
	// The count the sheet opened with, so a reload meanwhile doesn't change what it asks.
	let asked = $state(1);

	function show() {
		asked = count;
		first = '';
		label = '';
		problem = '';
		open = true;
	}

	const submit: SubmitFunction = ({ cancel }) => {
		if (busy) return cancel();
		busy = true;
		problem = '';
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure') {
					problem =
						(result.data as { error?: string } | undefined)?.error ??
						'Something went wrong. Please try again.';
					// Shows the date's dinners as they are now, such as one someone else added.
					await refreshAll();
					return;
				}
				if (result.type === 'success') open = false;
				await ownUpdate(result, () => update({ reset: false }));
				if (result.type === 'success') onadded();
			} finally {
				busy = false;
			}
		};
	};
</script>

<button type="button" onclick={show}>Add a dinner</button>

<Sheet bind:open title="Add a dinner">
	<form method="POST" action="?/addDinner" use:enhance={submit}>
		{#if asked === 1}
			<p>Give each dinner a label, such as Kids or Adults.</p>
			<div class="field">
				<label for="{uid}-first">Label for the dinner already planned</label>
				<input
					id="{uid}-first"
					name="firstLabel"
					autocomplete="off"
					maxlength={DINNER_LABEL_MAX}
					bind:value={first}
				/>
			</div>
		{/if}
		<div class="field">
			<label for="{uid}-label">Label for the new dinner</label>
			<input
				id="{uid}-label"
				name="label"
				autocomplete="off"
				maxlength={DINNER_LABEL_MAX}
				bind:value={label}
			/>
		</div>
		{#if problem}<p class="error" role="alert">{problem}</p>{/if}
		<div class="row">
			<button class="primary">Add dinner</button>
			<button type="button" onclick={() => (open = false)}>Cancel</button>
		</div>
	</form>
</Sheet>
