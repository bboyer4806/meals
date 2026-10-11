<script lang="ts">
	import { tick } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { filterCopyGroups } from '../copy-groups.ts';
	import { formatDateLabel } from '../dates.ts';
	import type { CopyGroup } from '../server/data/dinners.ts';
	import Sheet from './Sheet.svelte';

	// Copy a dinner (design 6.9, Q3, Q30): past dinners grouped by their dishes, most made first.
	// Typing keeps the groups with a matching dish, most recent first. Copying sets this dinner's
	// type and dishes and keeps its note and servings (2.3), so it asks before replacing dishes.
	let {
		groups,
		dinnerId,
		dishCount,
		today
	}: {
		groups: CopyGroup[];
		/** The dinner the page shows, if any, so a copy doesn't land on another one. */
		dinnerId: number | undefined;
		/** How many dishes this dinner has now. */
		dishCount: number;
		today: string;
	} = $props();

	const uid = $props.id();
	let open = $state(false);
	let search = $state('');
	let confirming = $state<CopyGroup | null>(null);
	let busy = $state(false);
	let problem = $state('');
	let searchInput = $state<HTMLInputElement>();
	let replaceButton = $state<HTMLButtonElement>();
	let opener = $state<HTMLButtonElement>();

	const shown = $derived(filterCopyGroups(groups, search));

	function show() {
		search = '';
		confirming = null;
		problem = '';
		open = true;
	}

	/** Asking replaces the list, so focus moves to the question's answer, and back again. */
	async function confirm(group: CopyGroup | null) {
		confirming = group;
		await tick();
		if (group) replaceButton?.focus();
		else searchInput?.focus();
	}

	function names(group: CopyGroup): string {
		return group.dishes.map((dish) => dish.name).join(', ');
	}

	function made(group: CopyGroup): string {
		const last = group.lastMade === today ? 'today' : formatDateLabel(group.lastMade, { today });
		return group.timesMade === 1 ? `Made ${last}` : `Made ${group.timesMade} times, last ${last}`;
	}

	const submit: SubmitFunction = ({ cancel }) => {
		if (busy) return cancel();
		busy = true;
		problem = '';
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure' || (result.type === 'error' && result.status === 404)) {
					problem =
						result.type === 'failure'
							? ((result.data as { error?: string } | undefined)?.error ??
								'Something went wrong. Please try again.')
							: 'That dinner is no longer on the menu. Pick another.';
					// Shows this dinner's dishes and the past dinners as they are now.
					await refreshAll();
					await confirm(null);
					return;
				}
				if (result.type !== 'success') {
					await update({ reset: false });
					return;
				}
				open = false;
				await update({ reset: false });
				// SvelteKit moves focus to the top of the page after a form succeeds. The sheet's
				// button gets it back, as when the sheet closes.
				await tick();
				opener?.focus();
			} finally {
				busy = false;
			}
		};
	};
</script>

{#snippet shownDinner()}
	{#if dinnerId !== undefined}<input type="hidden" name="dinnerId" value={dinnerId} />{/if}
{/snippet}

<button type="button" onclick={show} bind:this={opener}>Copy a dinner</button>

<Sheet bind:open title="Copy a dinner">
	{#if problem}<p class="error" role="alert">{problem}</p>{/if}
	{#if confirming}
		<p>
			Replace the {dishCount === 1 ? 'dish' : `${dishCount} dishes`} on this dinner with
			{names(confirming)}?
		</p>
		<form method="POST" action="?/copy" use:enhance={submit}>
			<input type="hidden" name="sourceId" value={confirming.dinnerId} />
			{@render shownDinner()}
			<input type="hidden" name="replaceDishes" value="1" />
			<div class="row">
				<button class="primary" bind:this={replaceButton}>Replace dishes</button>
				<button type="button" onclick={() => confirm(null)}>Back</button>
			</div>
		</form>
	{:else if groups.length === 0}
		<!-- This dinner's own group isn't offered, so it can be the only past dinner. -->
		<p class="muted">No past dinners to copy yet.</p>
	{:else}
		<label class="visually-hidden" for="{uid}-search">Search by dish</label>
		<input
			id="{uid}-search"
			type="search"
			placeholder="Search by dish"
			autocomplete="off"
			bind:value={search}
			bind:this={searchInput}
		/>
		{#if shown.length > 0}
			<form method="POST" action="?/copy" use:enhance={submit}>
				{@render shownDinner()}
				<ul class="groups">
					{#each shown as group (group.dinnerId)}
						<li>
							<!-- With dishes to replace, it asks first; otherwise it copies right away. -->
							<button
								class="group"
								name="sourceId"
								value={group.dinnerId}
								onclick={(event) => {
									if (dishCount === 0) return;
									event.preventDefault();
									void confirm(group);
								}}
							>
								<span class="names">{names(group)}</span>
								<span class="made">{made(group)}</span>
							</button>
						</li>
					{/each}
				</ul>
			</form>
		{:else}
			<p class="muted none">No past dinners with “{search.trim()}”.</p>
		{/if}
	{/if}
</Sheet>

<style>
	input[type='search'] {
		margin-bottom: 0.5rem;
	}

	.groups {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.group {
		width: 100%;
		flex-direction: column;
		align-items: flex-start;
		gap: 0;
		text-align: left;
	}

	.names {
		overflow-wrap: anywhere;
	}

	.made {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--muted);
	}

	.none {
		margin-top: 0.5rem;
	}
</style>
