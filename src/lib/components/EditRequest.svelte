<script lang="ts">
	import { tick } from 'svelte';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { REQUEST_NAME_MAX, REQUEST_NOTE_MAX } from '../menu.ts';
	import type { DishRequest } from '../server/data/requests.ts';
	import ItemInput from './ItemInput.svelte';
	import Sheet from './Sheet.svelte';

	// Edit on a request, on the Menu and on a date's page (design 6.12): a sheet with the request's
	// name and note as they are now, saved together. A dish request's name suggests the household's
	// active dishes, as Request a dish does, and a new one links the request as a new request's name
	// would, which may offer to restore an archived dish (6.10). Cancel, or closing the sheet, saves
	// nothing, and the next Edit starts again from the request as it is. The fields stop taking
	// characters at their limit, pasted text included, and say so while they're full.
	let {
		dishes
	}: {
		/** The household's active dishes, for the dish name's suggestions. */
		dishes: { id: number; name: string; timesAdded: number }[];
	} = $props();

	const uid = $props.id();
	const GONE = 'Someone completed or removed that request, so nothing was saved.';

	// The request as the page showed it when Edit was tapped, and that Edit, which gets focus back
	// once it's saved.
	let editing = $state<DishRequest | null>(null);
	let opener: HTMLElement | null = null;
	let open = $state(false);
	let name = $state('');
	let note = $state('');
	let problem = $state('');
	let saving = $state(false);

	/** Opens the sheet with the request's name and note as they are now. */
	export function edit(request: DishRequest, from: HTMLElement): void {
		editing = request;
		opener = from;
		name = request.name;
		note = request.note ?? '';
		problem = '';
		open = true;
	}

	function failureIn(result: ActionResult): string | null {
		if (result.type === 'failure') {
			return (
				(result.data as { error?: string } | undefined)?.error ??
				'Something went wrong. Please try again.'
			);
		}
		if (result.type === 'error' && result.status === 404) return GONE;
		return null;
	}

	/** The sheets close, and focus goes back to the request's Edit. */
	async function saved() {
		restoreOpen = false;
		open = false;
		await tick();
		opener?.focus();
	}

	const submitEdit: SubmitFunction = ({ cancel }) => {
		if (saving) return cancel();
		saving = true;
		problem = '';
		const sent = { name, note };
		return async ({ result, update }) => {
			try {
				const message = failureIn(result);
				if (message !== null) {
					problem = message;
					// Someone completed or removed it: the page shows the requests as they are now.
					if (result.type === 'error') await refreshAll();
					return;
				}
				const offer = result.type === 'success' ? archivedIn(result.data) : null;
				if (offer && editing) {
					// Nothing changed, so there's nothing to reload. This sheet stays open under that
					// one for Cancel.
					archived = { ...offer, requestId: editing.id, sentName: sent.name, sentNote: sent.note };
					restoreProblem = '';
					restoreOpen = true;
					return;
				}
				// Landing on the action's address would drop the Menu's ?week= and show this week.
				await update({ navigate: false, reset: false });
				if (result.type === 'success') await saved();
			} finally {
				saving = false;
			}
		};
	};

	// A new name that matches an archived dish offers to restore it, since its name stays taken
	// (6.10). The restore sends the name and note again, as the request keeps its name as typed.

	type Archived = { dishId: number; name: string };

	let archived = $state<
		(Archived & { requestId: number; sentName: string; sentNote: string }) | null
	>(null);
	let restoreOpen = $state(false);
	let restoreProblem = $state('');
	let restoring = $state(false);

	function archivedIn(data: unknown): Archived | null {
		return (data as { archived?: Archived | null } | undefined)?.archived ?? null;
	}

	const submitRestore: SubmitFunction = ({ cancel }) => {
		if (restoring) return cancel();
		restoring = true;
		restoreProblem = '';
		return async ({ result, update }) => {
			try {
				const message = failureIn(result);
				if (message !== null) {
					restoreProblem = message;
					if (result.type === 'error') await refreshAll();
					return;
				}
				await update({ navigate: false, reset: false });
				if (result.type === 'success') await saved();
			} finally {
				restoring = false;
			}
		};
	};
</script>

{#snippet limitWarning(text: string, max: number)}
	<!-- Always there, so a screen reader announces the warning when it appears. -->
	<p class="limit" role="status">
		{text.length >= max ? `You've reached the ${max}-character limit.` : ''}
	</p>
{/snippet}

<Sheet bind:open title="Edit request">
	{#if editing}
		<form method="POST" action="?/editRequest" use:enhance={submitEdit}>
			<input type="hidden" name="id" value={editing.id} />
			{#if problem}<p class="error" role="alert">{problem}</p>{/if}
			<div class="field">
				{#if editing.kind === 'dish'}
					<label for="{uid}-name">Dish</label>
					<!-- The suggestions show in the sheet under the field and its limit warning, so they
					     never cover Note or Save, as in Request a dish (MEA-151). -->
					<ItemInput
						id="{uid}-name"
						name="name"
						placeholder="Search or type a new dish"
						items={dishes}
						bind:value={name}
						noun="dish"
					>
						{@render limitWarning(name, REQUEST_NAME_MAX)}
					</ItemInput>
				{:else}
					<label for="{uid}-name">Restaurant</label>
					<input
						id="{uid}-name"
						name="name"
						autocomplete="off"
						required
						maxlength={REQUEST_NAME_MAX}
						bind:value={name}
					/>
					{@render limitWarning(name, REQUEST_NAME_MAX)}
				{/if}
			</div>
			<div class="field">
				<label for="{uid}-note">Note (optional)</label>
				<input
					id="{uid}-note"
					name="note"
					autocomplete="off"
					maxlength={REQUEST_NOTE_MAX}
					bind:value={note}
				/>
				{@render limitWarning(note, REQUEST_NOTE_MAX)}
			</div>
			<div class="row">
				<button class="primary">Save</button>
				<button type="button" onclick={() => (open = false)}>Cancel</button>
			</div>
		</form>
	{/if}
</Sheet>

<Sheet bind:open={restoreOpen} title={archived?.name ?? ''}>
	{#if archived}
		<p>{archived.name} is archived. Restore it and save the request?</p>
		<form method="POST" action="?/restoreAndEditRequest" use:enhance={submitRestore}>
			<input type="hidden" name="id" value={archived.requestId} />
			<input type="hidden" name="dishId" value={archived.dishId} />
			<input type="hidden" name="name" value={archived.sentName} />
			<input type="hidden" name="note" value={archived.sentNote} />
			{#if restoreProblem}<p class="error" role="alert">{restoreProblem}</p>{/if}
			<div class="row">
				<button class="primary">Restore it and save</button>
				<button type="button" onclick={() => (restoreOpen = false)}>Cancel</button>
			</div>
		</form>
	{/if}
</Sheet>

<style>
	/* Takes no room while empty. */
	.limit {
		margin: 0;
		color: var(--muted);
	}
</style>
