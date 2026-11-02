<script lang="ts">
	import { tick } from 'svelte';
	import { enhance, type ActionResult, type SubmitFunction } from '$app/forms';
	import { refreshAll } from '$app/navigation';
	import { DINNER_LABEL_MAX, DINNER_TYPE_LABELS, MAX_DINNERS, hasDishes } from '../menu.ts';
	import type { Dinner } from '../server/data/dinners.ts';
	import type { DishRequest } from '../server/data/requests.ts';
	import Sheet from './Sheet.svelte';

	// The Menu's requests on a date's page (design 6.12; 7, Dinner), under its dinners, each with
	// its dish or restaurant, the note and who asked. Add puts a requested dish on one of the date's
	// dinners: the only one that can have dishes, or the one the person picks when several can.
	// When none can, it goes on a new Cooking at home dinner. A requested restaurant always becomes
	// a new Eating out dinner. A new dinner on a date that has dinners needs labels, as Add a dinner
	// asks for (6.9). The request is then removed.
	let {
		requests,
		dinners,
		ownUpdate,
		onadded
	}: {
		/** The household's requests, oldest first. */
		requests: DishRequest[];
		/** The date's dinners as they are now, in the order they were added. */
		dinners: Dinner[];
		/** Reloads the page after a request is added, keeping what's typed in the dinners. */
		ownUpdate: (result: ActionResult, update: () => Promise<void>) => Promise<void>;
		/** After a request went on the dinner, with the request's note, if it has one. */
		onadded: (dinnerId: number, note: string | null) => void;
	} = $props();

	const uid = $props.id();
	const GONE = 'Someone removed that request, so nothing was added.';

	// The dinners a dish can go on: Cooking at home and Bringing a dish (Q26).
	const withDishes = $derived(dinners.filter((dinner) => hasDishes(dinner.type)));
	const only = $derived(withDishes.length === 1 ? withDishes[0] : undefined);
	// A new dinner on a date that has room for another asks for labels first. On a date with no
	// dinner, the request plans it; on a full date, the server says why not.
	const asksLabels = $derived(dinners.length > 0 && dinners.length < MAX_DINNERS);

	/**
	 * Whether Add asks first: for a dish, which dinner when several can have it, or the labels for a
	 * new one when none can; for a restaurant, the labels for its new dinner.
	 */
	function asks(request: DishRequest): boolean {
		if (request.kind === 'restaurant') return asksLabels;
		return withDishes.length > 1 || (withDishes.length === 0 && asksLabels);
	}

	/** The form action that adds the request to the date. */
	function actionFor(request: DishRequest): string {
		return request.kind === 'dish' ? '?/promoteDishRequest' : '?/promoteRestaurantRequest';
	}

	/** What the sheet says about the new dinner a request goes on, with the labels it asks for. */
	function newDinnerText(request: DishRequest, count: number): string {
		const labels =
			count === 1
				? 'Give each dinner a label, such as Kids or Adults.'
				: 'Give it a label, such as Kids or Adults.';
		if (request.kind === 'restaurant') {
			return `${request.name} goes on a new Eating out dinner. ${labels}`;
		}
		const why =
			count === 1
				? "This day's dinner can't have dishes"
				: "None of this day's dinners can have dishes";
		return `${why}, so ${request.name} goes on a new Cooking at home dinner. ${labels}`;
	}

	let problem = $state('');
	let status = $state('');
	let statusElement = $state<HTMLElement>();
	let busy = $state(false);

	// What the sheet asks about, as the page showed the date when it opened, so a reload meanwhile
	// doesn't change the question.
	let asked = $state<{
		request: DishRequest;
		choices: { id: number; label: string | null }[];
		count: number;
	} | null>(null);
	let open = $state(false);
	let sheetProblem = $state('');
	let first = $state('');
	let label = $state('');

	function ask(request: DishRequest) {
		asked = {
			request,
			// A restaurant never goes on a dinner the date has.
			choices:
				request.kind === 'dish'
					? withDishes.map((dinner) => ({ id: dinner.id, label: dinner.label }))
					: [],
			count: dinners.length
		};
		first = '';
		label = '';
		sheetProblem = '';
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

	function submitFor(request: DishRequest): SubmitFunction {
		return ({ cancel }) => {
			if (busy) return cancel();
			busy = true;
			problem = '';
			sheetProblem = '';
			status = '';
			const fromSheet = open;
			return async ({ result, update }) => {
				try {
					const message = failureIn(result);
					if (message !== null) {
						if (fromSheet) sheetProblem = message;
						else problem = message;
						// Shows the date's dinners and the requests as they are now.
						await refreshAll();
						return;
					}
					if (result.type !== 'success') {
						await update({ reset: false });
						return;
					}
					open = false;
					await ownUpdate(result, () => update({ reset: false }));
					await tick();
					const { dinnerId } = result.data as { dinnerId: number };
					onadded(dinnerId, request.note);
					const to = dinners.find((dinner) => dinner.id === dinnerId)?.label;
					status = to ? `Added ${request.name} to ${to}.` : `Added ${request.name}.`;
					// The request's Add went with it, and SvelteKit moves focus to the top of the page
					// after a form succeeds, so focus goes to what happened, which reads it out.
					await tick();
					statusElement?.focus();
				} finally {
					busy = false;
				}
			};
		};
	}

	// Sent from the sheet, for the request it asked about.
	const submitAsked: SubmitFunction = (input) =>
		asked ? submitFor(asked.request)(input) : input.cancel();
</script>

<!-- Any form sent, as the person goes on, takes the last message away. -->
<svelte:document
	onsubmit={() => {
		problem = '';
		status = '';
	}}
/>

<section class="card requests" aria-labelledby="{uid}-heading">
	<h2 id="{uid}-heading">Requests</h2>
	{#if status}<p class="status" tabindex="-1" bind:this={statusElement}>{status}</p>{/if}
	{#if problem}<p class="error" role="alert">{problem}</p>{/if}
	{#if requests.length > 0}
		<ul class="list">
			{#each requests as request (request.id)}
				<li class="request">
					<div class="what">
						{#if request.kind === 'dish'}
							<a class="dish" href="/recipes/{request.dishId}">{request.name}</a>
						{:else}
							<span class="kind">{DINNER_TYPE_LABELS.eat_out}</span>
							<span class="restaurant">{request.name}</span>
						{/if}
						{#if request.note}<span class="request-note">{request.note}</span>{/if}
						<span class="muted">Asked by {request.askedBy}</span>
					</div>
					<form method="POST" action={actionFor(request)} use:enhance={submitFor(request)}>
						<input type="hidden" name="requestId" value={request.id} />
						{#if request.kind === 'dish' && only}
							<input type="hidden" name="dinnerId" value={only.id} />
						{/if}
						<button
							aria-label="Add {request.name}"
							onclick={(event) => {
								if (!asks(request)) return;
								event.preventDefault();
								ask(request);
							}}>Add</button
						>
					</form>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">No requests yet.</p>
	{/if}
</section>

<Sheet bind:open title="Add {asked?.request.name ?? ''}">
	{#if asked}
		<form method="POST" action={actionFor(asked.request)} use:enhance={submitAsked}>
			<input type="hidden" name="requestId" value={asked.request.id} />
			{#if asked.choices.length > 1}
				<p>Which dinner should it go on?</p>
				<div class="choices">
					{#each asked.choices as choice (choice.id)}
						<button name="dinnerId" value={choice.id}>{choice.label}</button>
					{/each}
				</div>
			{:else}
				<p>{newDinnerText(asked.request, asked.count)}</p>
				{#if asked.count === 1}
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
			{/if}
			{#if sheetProblem}<p class="error" role="alert">{sheetProblem}</p>{/if}
			<div class="row">
				{#if asked.choices.length <= 1}<button class="primary">Add</button>{/if}
				<button type="button" onclick={() => (open = false)}>Cancel</button>
			</div>
		</form>
	{/if}
</Sheet>

<style>
	/* Set apart from the dinners above it. A long name without spaces still wraps. */
	.requests {
		margin-top: 1.5rem;
		overflow-wrap: anywhere;
	}

	h2 {
		margin-bottom: 0.25rem;
	}

	.status {
		margin: 0 0 0.25rem;
		font-weight: 700;
		color: var(--received);
	}

	.request {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.what {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.dish,
	.restaurant {
		font-weight: 700;
	}

	/* "Eating out" over a restaurant's name, as the week shows it. */
	.kind {
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}

	.request-note {
		white-space: pre-line;
	}

	/* One button per dinner, its label, two by two on a phone. */
	.choices {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.5rem;
		margin-bottom: 1rem;
	}
</style>
