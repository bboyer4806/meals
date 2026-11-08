<script lang="ts">
	import { tick } from 'svelte';
	import { prefersReducedMotion } from 'svelte/motion';
	import { enhance, type SubmitFunction } from '$app/forms';
	import { afterNavigate, goto, onNavigate, refreshAll } from '$app/navigation';
	import EditRequest from '#lib/components/EditRequest.svelte';
	import ItemInput from '#lib/components/ItemInput.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import { formatDateLabel } from '#lib/dates.ts';
	import {
		DINNER_TYPE_LABELS,
		DISH_ROLE_LABELS,
		REQUEST_NAME_MAX,
		REQUEST_NOTE_MAX,
		hasDishes
	} from '#lib/menu.ts';

	let { data } = $props();

	// Saving a dinner's servings and note comes here with ?saved=<its id> (design 7, Dinner),
	// and that dinner's line says "Saved" for 3 seconds. The week scrolls to that dinner's day, so
	// the line is on screen (MEA-192). The address drops it straight away, so a reload, or coming
	// back with Back, doesn't say it again.
	let saved = $state<string | null>(null);
	let savedTimer: ReturnType<typeof setTimeout> | undefined;
	afterNavigate(({ to, shallow }) => {
		// Dropping it from the address is a navigation too.
		if (shallow || !to) return;
		clearTimeout(savedTimer);
		const dinnerId = to.url.searchParams.get('saved');
		saved = dinnerId;
		if (dinnerId === null) return;
		savedTimer = setTimeout(() => (saved = null), 3000);
		const address = new URL(to.url);
		address.searchParams.delete('saved');
		void goto(address, { shallow: true, replace: true });
		void tick().then(() => showDayOf(dinnerId));
	});

	/** Scrolls the dinner's day to the middle of the screen, clear of the header and tabs. */
	function showDayOf(dinnerId: string) {
		const day = data.days.find(({ dinners }) => dinners.some(({ id }) => String(id) === dinnerId));
		// Someone cleared or moved it since, so this week has no line to show.
		if (!day) return;
		document.querySelector(`a.day[data-date="${day.date}"]`)?.scrollIntoView({ block: 'center' });
	}

	// Requests for a dish or a restaurant (6.12). The fields stop taking characters at their limit,
	// pasted text included, and say so while they're full.

	let requestOpen = $state(false);
	let requestName = $state('');
	let requestNote = $state('');
	let requestError = $state('');
	let requesting = $state(false);
	let requestsError = $state('');
	let requestButton = $state<HTMLButtonElement>();
	// Edit on a request opens its sheet, shared with a date's page (6.12).
	let editor = $state<ReturnType<typeof EditRequest>>();

	function failureMessage(data: unknown): string {
		const error = (data as { error?: string } | undefined)?.error;
		return error ?? 'Something went wrong. Please try again.';
	}

	function openRequest() {
		requestError = '';
		requestOpen = true;
	}

	/** The request is in: the sheet closes and the list shows it. */
	async function requested() {
		requestName = '';
		requestNote = '';
		requestOpen = false;
		await tick();
		requestButton?.focus();
	}

	const submitRequest: SubmitFunction = ({ cancel }) => {
		if (requesting) return cancel();
		requesting = true;
		requestError = '';
		const sent = { name: requestName, note: requestNote };
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure') {
					requestError = failureMessage(result.data);
					return;
				}
				const offer = result.type === 'success' ? archivedIn(result.data) : null;
				if (offer) {
					// Nothing changed, so there's nothing to reload. The Request sheet stays open
					// under this one for Cancel.
					archived = { ...offer, sentName: sent.name, sentNote: sent.note };
					restoreError = '';
					restoreOpen = true;
					return;
				}
				await update({ reset: false });
				if (result.type === 'success') await requested();
			} finally {
				requesting = false;
			}
		};
	};

	// A request for an archived dish's name offers to restore it, since its name stays taken
	// (6.10). The restore sends the name and note again, as the request keeps its name as typed.

	type Archived = { dishId: number; name: string };

	let archived = $state<(Archived & { sentName: string; sentNote: string }) | null>(null);
	let restoreOpen = $state(false);
	let restoreError = $state('');
	let restoring = $state(false);

	function archivedIn(data: unknown): Archived | null {
		return (data as { archived?: Archived | null } | undefined)?.archived ?? null;
	}

	const submitRestore: SubmitFunction = ({ cancel }) => {
		if (restoring) return cancel();
		restoring = true;
		restoreError = '';
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure') {
					restoreError = failureMessage(result.data);
					return;
				}
				await update({ reset: false });
				if (result.type !== 'success') return;
				restoreOpen = false;
				await requested();
			} finally {
				restoring = false;
			}
		};
	};

	// A restaurant request is only its name and note, linked to nothing.

	let restaurantOpen = $state(false);
	let restaurantName = $state('');
	let restaurantNote = $state('');
	let restaurantError = $state('');
	let requestingRestaurant = $state(false);
	let restaurantButton = $state<HTMLButtonElement>();

	function openRestaurant() {
		restaurantError = '';
		restaurantOpen = true;
	}

	const submitRestaurant: SubmitFunction = ({ cancel }) => {
		if (requestingRestaurant) return cancel();
		requestingRestaurant = true;
		restaurantError = '';
		return async ({ result, update }) => {
			try {
				if (result.type === 'failure') {
					restaurantError = failureMessage(result.data);
					return;
				}
				// Landing on ?/requestRestaurant would drop ?week= and show this week instead.
				await update({ navigate: false, reset: false });
				if (result.type !== 'success') return;
				restaurantName = '';
				restaurantNote = '';
				restaurantOpen = false;
				await tick();
				restaurantButton?.focus();
			} finally {
				requestingRestaurant = false;
			}
		};
	};

	// Swiping the week's days sideways changes the week, like Previous and Next (design 7, Menu):
	// to the left for the next week, to the right for the previous one, one week per swipe however
	// far it goes. It takes one finger going at least SWIPE_DISTANCE pixels across, and at least
	// twice as far across as up or down, so taps, pinches, scrolling and slanted swipes change
	// nothing. Nothing here stops the browser scrolling, and a swipe moves too far to be a tap, so
	// the browser sends no click and the day it started on doesn't open.
	//
	// The days follow a finger that sets off across rather than up or down, with the weeks before
	// and after beside them, and when it lifts they slide on into the week it opens, or back into
	// place (MEA-249). That week shows once they're in place, with the page scrolled where it was.
	// Until the days are in place and the week has opened, another swipe does nothing.

	const SWIPE_DISTANCE = 60;
	// How far a finger goes before it's clear whether it's moving the days or scrolling the page.
	const SWIPE_SLOP = 10;
	const SLIDE_MS = 250;

	// Where the finger started, and whether the days follow it, once it's gone SWIPE_SLOP pixels.
	let swipe: { x: number; y: number; follow?: boolean } | null = null;
	let track: HTMLElement;
	// How far the finger has moved the days, in pixels; to the left is negative.
	let dragged = $state(0);
	// The days sliding into place once the finger lifts.
	let settling = $state<Promise<void> | null>(null);
	// The week the days slid away from, and which way, until the week they slid to opens.
	let slid = $state<{ from: string; to: 'previous' | 'next' } | null>(null);
	const slidTo = $derived(slid?.from === data.start ? slid.to : null);
	// A week over is the days' width and the 2rem between weeks.
	const shift = $derived(
		slidTo === 'next'
			? 'calc(-100% - 2rem)'
			: slidTo === 'previous'
				? 'calc(100% + 2rem)'
				: `${dragged}px`
	);
	const moving = $derived(dragged !== 0 || settling !== null || slidTo !== null);

	// A new week or page shows once the days are in place.
	onNavigate(() => settling ?? undefined);

	function startSwipe(event: TouchEvent) {
		// A second finger makes it a pinch.
		if (event.touches.length > 1) return cancelSwipe();
		const touch = event.touches[0];
		swipe =
			touch && settling === null && slid === null ? { x: touch.clientX, y: touch.clientY } : null;
	}

	// A second finger, even off the days, makes it a pinch.
	function moveSwipe(event: TouchEvent) {
		if (event.touches.length > 1) return cancelSwipe();
		const touch = event.touches[0];
		if (!swipe || !touch) return;
		const across = touch.clientX - swipe.x;
		const down = touch.clientY - swipe.y;
		if (swipe.follow === undefined && Math.hypot(across, down) >= SWIPE_SLOP) {
			swipe.follow = Math.abs(across) >= 2 * Math.abs(down);
		}
		if (swipe.follow) dragged = across;
	}

	function endSwipe(event: TouchEvent) {
		const start = swipe;
		const end = event.changedTouches[0];
		swipe = null;
		if (!start || !end) return;
		const across = end.clientX - start.x;
		const down = end.clientY - start.y;
		if (Math.abs(across) < SWIPE_DISTANCE || Math.abs(across) < 2 * Math.abs(down)) {
			slideBack();
			return;
		}
		void slideTo(across < 0 ? 'next' : 'previous');
	}

	// An interrupted swipe, or one that becomes a pinch, changes nothing.
	function cancelSwipe() {
		swipe = null;
		slideBack();
	}

	function slideBack() {
		if (dragged !== 0) settle(() => (dragged = 0));
	}

	async function slideTo(to: 'previous' | 'next') {
		const week = to === 'next' ? data.next : data.previous;
		const from = data.start;
		settle(() => {
			slid = { from, to };
			dragged = 0;
		});
		try {
			await goto(`/menu?week=${week}`, { reset: false });
		} finally {
			slid = null;
		}
	}

	/** Slides the days from where they are to where `move` puts them. */
	function settle(move: () => void) {
		const from = `translateX(${shift})`;
		move();
		const animation = track.animate(
			[{ transform: from }, { transform: `translateX(${shift})` }],
			{ duration: prefersReducedMotion.current ? 0 : SLIDE_MS, easing: 'ease-out' }
		);
		settling = animation.finished.then(() => {
			settling = null;
		});
	}

	// Dragging a day onto another swaps their dinners, like Move to another date (2.2.2, 6.9).
	// Only a mouse drags (trackpads report as one), so on touch screens tapping still opens a day
	// and swiping scrolls or changes the week (above). A drag starts once the pointer moves a few
	// pixels; a click without that still opens the day.

	const DRAG_DISTANCE = 5;
	const MOVED_SINCE = "Someone cleared or moved that day's dinners, so nothing moved.";

	let press: { from: string; dinnerId: number; x: number; y: number } | null = null;
	let dragging = $state<{ from: string; dinnerId: number } | null>(null);
	let dropTarget = $state<string | null>(null);
	// The drop's click would open the day under it.
	let swallowClick = false;
	let move = $state({ from: '', to: '', dinnerId: 0 });
	let moveForm = $state<HTMLFormElement>();
	let moveError = $state('');

	function pressDay(event: PointerEvent, from: string, dinnerId: number | undefined) {
		if (event.pointerType !== 'mouse' || event.button !== 0 || dinnerId === undefined) return;
		press = { from, dinnerId, x: event.clientX, y: event.clientY };
		// Keeps the drag's events coming when the pointer leaves the window.
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	}

	/** The day under the pointer, if any. */
	function dayAt(event: PointerEvent): string | null {
		const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('a.day');
		return row instanceof HTMLElement ? (row.dataset.date ?? null) : null;
	}

	function movePointer(event: PointerEvent) {
		if (press && !dragging) {
			if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < DRAG_DISTANCE) return;
			dragging = { from: press.from, dinnerId: press.dinnerId };
			moveError = '';
			window.getSelection()?.removeAllRanges();
		}
		if (dragging) dropTarget = dayAt(event);
	}

	function release(event: PointerEvent) {
		const drag = dragging;
		endDrag();
		if (!drag) return;
		swallowClick = true;
		const to = dayAt(event);
		if (to === null || to === drag.from) return;
		move = { from: drag.from, to, dinnerId: drag.dinnerId };
		void tick().then(() => moveForm?.requestSubmit());
	}

	function endDrag() {
		press = null;
		dragging = null;
		dropTarget = null;
	}

	function clickCapture(event: MouseEvent) {
		if (!swallowClick) return;
		swallowClick = false;
		event.preventDefault();
		event.stopPropagation();
	}

	// Someone may have cleared or moved the dragged day's dinners since the page loaded; the week
	// then shows the menu as it is now (2.2.2).
	const submitMove: SubmitFunction = () => {
		moveError = '';
		return async ({ result, update }) => {
			if (result.type === 'failure' || (result.type === 'error' && result.status === 404)) {
				moveError = MOVED_SINCE;
				await refreshAll();
				return;
			}
			// Landing on ?/move would drop ?week= and show this week instead.
			await update({ navigate: false });
		};
	};

	// Complete or Remove on a request. Someone else may have completed or removed it meanwhile, and
	// the page then shows the requests as they are now (6.11).
	const submitRequestChange: SubmitFunction = () => {
		requestsError = '';
		return async ({ result, update }) => {
			if (result.type === 'error' && result.status === 404) {
				await refreshAll();
			} else if (result.type === 'failure') {
				requestsError = failureMessage(result.data);
			} else {
				// Landing on the action's address would drop ?week= and show this week instead.
				await update({ navigate: false });
			}
			// The request's buttons went with it.
			await tick();
			requestButton?.focus();
		};
	};
</script>

{#snippet limitWarning(text: string, max: number)}
	<!-- Always there, so a screen reader announces the warning when it appears. -->
	<p class="limit" role="status">
		{text.length >= max ? `You've reached the ${max}-character limit.` : ''}
	</p>
{/snippet}

<svelte:head>
	<title>Menu · Meals</title>
</svelte:head>

<h1>Menu</h1>

<nav class="weeks" aria-label="Weeks">
	<p class="label" aria-live="polite">{data.label}</p>
	<div class="week-buttons">
		<a class="button" href="/menu?week={data.previous}">
			<span aria-hidden="true">‹</span> Previous
		</a>
		<a class="button" href="/menu" aria-current={data.isThisWeek ? 'page' : undefined}>This week</a>
		<a class="button" href="/menu?week={data.next}">Next <span aria-hidden="true">›</span></a>
	</div>
</nav>

<!-- A dinner's type, its restaurant or dishes by role, and note. -->
{#snippet details(dinner: (typeof data.days)[number]['dinners'][number])}
	<span class="type">{DINNER_TYPE_LABELS[dinner.type]}</span>
	{#if dinner.restaurantName}<span class="restaurant-name">{dinner.restaurantName}</span>{/if}
	{#each dinner.roles as group (group.role)}
		<span class="dishes">
			<span class="role">{DISH_ROLE_LABELS[group.role]}</span>
			<span class="names">{group.names.join(', ')}</span>
		</span>
	{:else}
		{#if hasDishes(dinner.type)}<span class="muted">No dishes yet</span>{/if}
	{/each}
	{#if dinner.note}<span class="note">{dinner.note}</span>{/if}
{/snippet}

<!-- Always there, so a screen reader announces "Saved" when it appears. -->
{#snippet savedStatus(shown: boolean)}
	<span class="saved" role="status">{shown ? 'Saved' : ''}</span>
{/snippet}

<svelte:window
	onpointerdown={() => (swallowClick = false)}
	onpointermove={movePointer}
	onpointerup={release}
	onpointercancel={endDrag}
	onclickcapture={clickCapture}
/>

{#if moveError}<p class="error" role="alert">{moveError}</p>{/if}

<form method="POST" action="?/move" hidden bind:this={moveForm} use:enhance={submitMove}>
	<input type="hidden" name="from" value={move.from} />
	<input type="hidden" name="to" value={move.to} />
	<input type="hidden" name="dinnerId" value={move.dinnerId} />
</form>

<!-- A day's date, with Today, and its dinners or "Not planned". -->
{#snippet dayDetails(day: (typeof data.days)[number])}
	{@const { dinners } = day}
	{@const only = dinners.length === 1 ? dinners[0] : undefined}
	<span class="when">
		<span class="date">{formatDateLabel(day.date)}</span>
		{#if day.date === data.today}<span class="today-badge">Today</span>{/if}
		<!-- A day's only dinner is its row; with more, each dinner has its own line (6.9). -->
		{@render savedStatus(only !== undefined && saved === String(only.id))}
	</span>
	{#if only}
		{@render details(only)}
	{:else if dinners.length > 0}
		{#each dinners as dinner (dinner.id)}
			<span class="dinner">
				<span class="label">
					{dinner.label}
					{@render savedStatus(saved === String(dinner.id))}
				</span>
				{@render details(dinner)}
			</span>
		{/each}
	{:else}
		<span class="muted">Not planned</span>
	{/if}
{/snippet}

<!-- The week before or after, beside the days while a swipe moves them (MEA-249). It only shows
     what that week holds, so it has no links and screen readers skip it. -->
{#snippet besideWeek(days: typeof data.days | null, side: 'previous' | 'next')}
	<ol
		class="days beside"
		class:previous-week={side === 'previous'}
		class:next-week={side === 'next'}
		aria-hidden="true"
	>
		{#each days ?? [] as day (day.date)}
			<li>
				<div class="day card" class:today={day.date === data.today}>{@render dayDetails(day)}</div>
			</li>
		{/each}
	</ol>
{/snippet}

<div class="slider">
	<div class="track" bind:this={track} style:transform="translateX({shift})">
		<ol
			class="days"
			class:dragging={dragging !== null}
			ontouchstart={startSwipe}
			ontouchmove={moveSwipe}
			ontouchend={endSwipe}
			ontouchcancel={cancelSwipe}
		>
			{#each data.days as day (day.date)}
				{@const isToday = day.date === data.today}
				<li>
					<!-- draggable="false" keeps the browser's own link drag out of the way. -->
					<a
						class="day card"
						class:today={isToday}
						class:source={dragging?.from === day.date}
						class:target={dragging !== null &&
							dropTarget === day.date &&
							dropTarget !== dragging.from}
						href="/menu/{day.date}"
						aria-current={isToday ? 'date' : undefined}
						data-date={day.date}
						draggable="false"
						onpointerdown={(event) => pressDay(event, day.date, day.dinners[0]?.id)}
					>
						{@render dayDetails(day)}
					</a>
				</li>
			{/each}
		</ol>
		{#if moving}
			{@render besideWeek(data.previousDays, 'previous')}
			{@render besideWeek(data.nextDays, 'next')}
		{/if}
	</div>
</div>

<!-- A request's dish, linked to its recipe, or "Eating out" and its restaurant, then its note and
     who asked, as both lists show it. -->
{#snippet requestDetails(request: (typeof data.requests)[number])}
	{#if request.kind === 'dish'}
		<a class="dish link-tap" href="/recipes/{request.dishId}">{request.name}</a>
	{:else}
		<span class="kind">{DINNER_TYPE_LABELS.eat_out}</span>
		<span class="restaurant">{request.name}</span>
	{/if}
	{#if request.note}<span class="request-note">{request.note}</span>{/if}
	<span class="muted">Asked by {request.askedBy}</span>
{/snippet}

<section class="card requests" aria-labelledby="requests-heading">
	<h2 id="requests-heading">Requests</h2>
	{#if requestsError}<p class="error" role="alert">{requestsError}</p>{/if}
	{#if data.requests.length > 0}
		<ul class="list">
			{#each data.requests as request (request.id)}
				<li class="request">
					<div class="what">{@render requestDetails(request)}</div>
					<div class="request-actions">
						<button
							type="button"
							class="quiet"
							aria-label="Edit {request.name}"
							onclick={(event) => editor?.edit(request, event.currentTarget)}>Edit</button
						>
						<form method="POST" action="?/completeRequest" use:enhance={submitRequestChange}>
							<input type="hidden" name="id" value={request.id} />
							<button class="quiet" aria-label="Complete {request.name}">Complete</button>
						</form>
						<form method="POST" action="?/removeRequest" use:enhance={submitRequestChange}>
							<input type="hidden" name="id" value={request.id} />
							<button class="quiet" aria-label="Remove {request.name}">Remove</button>
						</form>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">No requests yet.</p>
	{/if}
	<div class="request-buttons">
		<button type="button" bind:this={requestButton} onclick={openRequest}>Request a dish</button>
		<button type="button" bind:this={restaurantButton} onclick={openRestaurant}>
			Request a restaurant
		</button>
	</div>
</section>

<!-- Folded away each time the page opens, until its heading is tapped (6.12). -->
<details class="card completed">
	<summary><h2>Completed requests</h2></summary>
	{#if data.completed.length > 0}
		<ul class="list">
			{#each data.completed as request (request.id)}
				<li class="request">
					<div class="what">
						{@render requestDetails(request)}
						<span class="muted">
							Completed {formatDateLabel(request.completedOn, { today: data.today })}
						</span>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="muted">No completed requests yet.</p>
	{/if}
</details>

<Sheet bind:open={requestOpen} title="Request a dish">
	<form method="POST" action="?/request" use:enhance={submitRequest}>
		{#if requestError}<p class="error" role="alert">{requestError}</p>{/if}
		<div class="field">
			<label for="request-name">Dish</label>
			<!-- The suggestions show in the sheet under the field and its limit warning, so they never
			     cover Note or Request (MEA-151). -->
			<ItemInput
				id="request-name"
				name="name"
				placeholder="Search or type a new dish"
				items={data.dishes}
				bind:value={requestName}
				noun="dish"
			>
				{@render limitWarning(requestName, REQUEST_NAME_MAX)}
			</ItemInput>
		</div>
		<div class="field">
			<label for="request-note">Note (optional)</label>
			<input
				id="request-note"
				name="note"
				autocomplete="off"
				maxlength={REQUEST_NOTE_MAX}
				bind:value={requestNote}
			/>
			{@render limitWarning(requestNote, REQUEST_NOTE_MAX)}
		</div>
		<button class="primary">Request</button>
	</form>
</Sheet>

<Sheet bind:open={restaurantOpen} title="Request a restaurant">
	<form method="POST" action="?/requestRestaurant" use:enhance={submitRestaurant}>
		{#if restaurantError}<p class="error" role="alert">{restaurantError}</p>{/if}
		<div class="field">
			<label for="restaurant-name">Restaurant</label>
			<input
				id="restaurant-name"
				name="name"
				autocomplete="off"
				required
				maxlength={REQUEST_NAME_MAX}
				bind:value={restaurantName}
			/>
			{@render limitWarning(restaurantName, REQUEST_NAME_MAX)}
		</div>
		<div class="field">
			<label for="restaurant-note">Note (optional)</label>
			<input
				id="restaurant-note"
				name="note"
				autocomplete="off"
				maxlength={REQUEST_NOTE_MAX}
				bind:value={restaurantNote}
			/>
			{@render limitWarning(restaurantNote, REQUEST_NOTE_MAX)}
		</div>
		<button class="primary">Request</button>
	</form>
</Sheet>

<EditRequest dishes={data.dishes} bind:this={editor} />

<Sheet bind:open={restoreOpen} title={archived?.name ?? ''}>
	{#if archived}
		<p>{archived.name} is archived. Restore it and request it?</p>
		<form method="POST" action="?/restoreRequest" use:enhance={submitRestore}>
			<input type="hidden" name="dishId" value={archived.dishId} />
			<input type="hidden" name="name" value={archived.sentName} />
			<input type="hidden" name="note" value={archived.sentNote} />
			{#if restoreError}<p class="error" role="alert">{restoreError}</p>{/if}
			<div class="row">
				<button class="primary">Restore it and request</button>
				<button type="button" onclick={() => (restoreOpen = false)}>Cancel</button>
			</div>
		</form>
	{/if}
</Sheet>

<style>
	.weeks {
		margin-bottom: 0.75rem;
	}

	.label {
		margin: 0 0 0.5rem;
		font-weight: 700;
	}

	/* Three even buttons that fit a phone. */
	.week-buttons {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 0.5rem;
	}

	.week-buttons .button {
		padding-inline: 0.5rem;
		white-space: nowrap;
	}

	.week-buttons [aria-current='page'] {
		background: var(--surface-sunk);
		border-color: var(--muted);
	}

	/* What a swipe moves shows out to the page's edges, past its 1rem padding, with room for a
	   day's outline above and below. Nothing past them shows or scrolls the page sideways. */
	.slider {
		margin: -0.5rem -1rem;
		padding: 0.5rem 1rem;
		overflow: clip;
	}

	.track {
		position: relative;
	}

	/* A week over on either side, 2rem away: the page's padding on both sides, as on a page of
	   its own. */
	.beside {
		position: absolute;
		top: 0;
		width: 100%;
	}

	.previous-week {
		right: calc(100% + 2rem);
	}

	.next-week {
		left: calc(100% + 2rem);
	}

	.days {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 0.5rem;
	}

	.day {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		min-height: var(--tap);
		margin: 0;
		/* Room on the right for the arrow. */
		padding: 0.6rem 2rem 0.7rem 1rem;
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	.day::after {
		content: '›';
		position: absolute;
		right: 0.85rem;
		top: 50%;
		transform: translateY(-50%);
		font-size: 1.4rem;
		color: var(--muted);
	}

	/* While dragging, text doesn't get selected and the day under the pointer is outlined. */
	.dragging {
		user-select: none;
		cursor: grabbing;
	}

	.dragging .day {
		cursor: grabbing;
	}

	.day.source {
		opacity: 0.6;
	}

	.day.target {
		outline: 3px solid var(--accent);
		outline-offset: 2px;
	}

	/* A thicker accent border and a label, so today doesn't rely on color alone. */
	.day.today {
		border: 2px solid var(--accent);
		padding: calc(0.6rem - 1px) calc(2rem - 1px) calc(0.7rem - 1px) calc(1rem - 1px);
	}

	.when {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.date {
		font-family: var(--font-heading);
		font-size: 1.15rem;
		font-weight: 600;
	}

	.today-badge {
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--on-accent);
		background: var(--accent);
		border-radius: 999px;
		padding: 0 0.5rem;
	}

	.saved {
		font-weight: 700;
		color: var(--received);
	}

	.type {
		font-weight: 700;
	}

	.dinner {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}

	.dinner + .dinner {
		margin-top: 0.35rem;
		padding-top: 0.35rem;
		border-top: 1px solid var(--border);
	}

	.label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-family: var(--font-heading);
		font-weight: 600;
	}

	.dishes {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.role {
		flex: none;
		width: 5rem;
		white-space: nowrap;
		font-size: 0.8rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}

	.names {
		min-width: 0;
	}

	/* The whole note, with its line breaks (design 7, Menu). */
	.note {
		color: var(--muted);
		white-space: pre-line;
	}

	.requests {
		margin-top: 1rem;
		overflow-wrap: anywhere;
	}

	.requests ul {
		margin-bottom: 0.75rem;
	}

	/* Edit, Complete and Remove beside the request, or under it, on the right, when they don't
	   fit. */
	.request {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 0.5rem;
	}

	.what {
		flex: 1 1 10rem;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.request-actions {
		display: flex;
		margin-left: auto;
	}

	/* Like a store's group on the grocery list, with the arrow turning as it opens. */
	.completed {
		padding-block: 0.25rem;
		overflow-wrap: anywhere;
	}

	.completed summary {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: var(--tap);
		cursor: pointer;
		list-style: none;
	}

	.completed summary::-webkit-details-marker {
		display: none;
	}

	.completed summary::before {
		content: '▸';
		color: var(--muted);
		transition: transform 0.15s;
	}

	.completed[open] > summary::before {
		transform: rotate(90deg);
	}

	.completed h2 {
		margin: 0;
	}

	.dish,
	.restaurant {
		font-weight: 700;
	}

	/* "Eating out" over a restaurant's name, styled like a dish's role on the week. */
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

	/* Side by side, wrapping onto two lines when they don't fit. */
	.request-buttons {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	/* Takes no room while empty. */
	.limit {
		margin: 0;
		color: var(--muted);
	}
</style>
