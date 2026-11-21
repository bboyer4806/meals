<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { partyListNameFor } from '../menu.ts';
	import type { Dinner } from '../server/data/dinners.ts';
	import type { DinnerIngredientsAdded } from '../server/data/party-lists.ts';
	import { problemIn, WENT_WRONG } from '../submit.ts';
	import { joinAnd } from '../text.ts';
	import Sheet from './Sheet.svelte';

	// Add to party list (design 6.15, MEA-268): puts what a party dinner's dishes need, for its
	// servings, on one of the household's party lists, or on a new one whose name starts as the
	// dinner's label (or Party) and date. Then it says how many things went on which list, with a
	// link to it, and names what to look at there. It changes no dinner, so it isn't one of the
	// page's own changes (send), and what's typed in the dinner's forms stays as it is.
	let {
		dinner,
		partyLists,
		onlost
	}: {
		/** A dinner with dishes, as it is now. */
		dinner: Dinner;
		/** The household's party lists, by name. */
		partyLists: { id: number; name: string }[];
		/** Shows a failure on the page, once the dinner it was for is gone from this one. */
		onlost: (message: string) => void;
	} = $props();

	const DINNER_GONE = "Someone cleared or moved this dinner, so its ingredients weren't added.";
	const LIST_GONE = 'Someone deleted that party list. Pick another, or start a new one.';

	const uid = $props.id();
	let open = $state(false);
	let busy = $state(false);
	let problem = $state('');
	let name = $state('');
	let added = $state<DinnerIngredientsAdded | null>(null);
	let opener = $state<HTMLButtonElement>();

	// Set once this is off the page, as when someone took the dinner's dishes off meanwhile.
	let removed = false;
	onDestroy(() => (removed = true));

	function show() {
		name = partyListNameFor(dinner.label, dinner.date);
		problem = '';
		open = true;
	}

	/** "Added 3 things to", before the list's name. */
	function addedText(count: number): string {
		if (count === 0) return 'Nothing was added to';
		return `Added ${count} ${count === 1 ? 'thing' : 'things'} to`;
	}

	/** What to look at on the list: things to set, and what was left as it was or left out. */
	function notes({ unmeasured, alreadyOnList, archived }: DinnerIngredientsAdded): string[] {
		const notes: string[] = [];
		if (unmeasured.length > 0) {
			const are = unmeasured.length === 1 ? 'is' : 'are';
			notes.push(
				`${joinAnd(unmeasured)} ${are} on the list as 1. Set how much the party needs there.`
			);
		}
		if (alreadyOnList.length > 0) {
			const one = alreadyOnList.length === 1;
			notes.push(
				`${joinAnd(alreadyOnList)} ${one ? 'was' : 'were'} already on the list and ${one ? "wasn't" : "weren't"} changed.`
			);
		}
		if (archived.length > 0) {
			const one = archived.length === 1;
			notes.push(
				`${joinAnd(archived)} ${one ? 'is' : 'are'} archived, so ${one ? "it wasn't" : "they weren't"} added. Restore ${one ? 'it' : 'them'} on Items first.`
			);
		}
		return notes;
	}

	const submit: SubmitFunction = ({ cancel }) => {
		if (busy) return cancel();
		busy = true;
		problem = '';
		const sentFor = dinner.id;
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure' || (result.type === 'error' && result.status === 404)) {
					// Someone may have changed the dinner or the party lists since the page showed them,
					// so it shows them as they are now. When that takes the dinner off this form, the
					// page says what happened instead.
					await refreshAll();
					await tick();
					const here = !removed && dinner.id === sentFor;
					const message =
						result.type === 'failure'
							? ((result.data as { error?: string } | undefined)?.error ?? WENT_WRONG)
							: here
								? LIST_GONE
								: DINNER_GONE;
					if (here) problem = message;
					else {
						open = false;
						onlost(message);
					}
					return;
				}
				// No answer from Meals, or an error there: the page stays as it is (6.11).
				const message = problemIn(result);
				if (message !== null) {
					problem = message;
					return;
				}
				if (result.type === 'success') {
					added = result.data as DinnerIngredientsAdded;
					open = false;
				}
				await update({ reset: false });
				if (result.type !== 'success') return;
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

<!-- Any form sent, as the person goes on, takes the last message away. -->
<svelte:document onsubmit={() => (added = null)} />

<button type="button" onclick={show} bind:this={opener}>Add to party list</button>

<Sheet bind:open title="Add to party list">
	<p>
		Puts what this dinner's dishes need, for its {dinner.servings}
		{dinner.servings === 1 ? 'serving' : 'servings'}, on a party list.
	</p>
	{#if problem}<p class="error" role="alert">{problem}</p>{/if}
	{#if partyLists.length > 0}
		<form method="POST" action="?/addToPartyList" use:enhance={submit} aria-label="Your party lists">
			<input type="hidden" name="dinnerId" value={dinner.id} />
			<ul class="lists">
				{#each partyLists as list (list.id)}
					<li><button class="pick" name="listId" value={list.id}>{list.name}</button></li>
				{/each}
			</ul>
		</form>
	{/if}
	<form method="POST" action="?/addToNewPartyList" use:enhance={submit}>
		<input type="hidden" name="dinnerId" value={dinner.id} />
		<label for="{uid}-name">New list</label>
		<div class="row">
			<input
				class="grow"
				id="{uid}-name"
				name="name"
				required
				maxlength="60"
				autocomplete="off"
				bind:value={name}
			/>
			<button class="primary">Add to new list</button>
		</div>
	</form>
</Sheet>

{#if added}
	<!-- Under the dinner's buttons, across the row they're in. -->
	<div class="added" role="status">
		<p>
			{addedText(added.added)}
			<a href="/groceries/parties/{added.list.id}">{added.list.name}</a>.
		</p>
		{#each notes(added) as note (note)}
			<p>{note}</p>
		{/each}
	</div>
{/if}

<style>
	.lists {
		list-style: none;
		margin: 0 0 1rem;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.pick {
		width: 100%;
		justify-content: flex-start;
		text-align: left;
		overflow-wrap: anywhere;
	}

	.added {
		grid-column: 1 / -1;
		overflow-wrap: anywhere;
	}

	.added p {
		margin: 0.25rem 0 0;
	}
</style>
