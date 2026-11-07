<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import SearchBox from '#lib/components/SearchBox.svelte';
	import { formatDateLabel } from '#lib/dates.ts';
	import { formatMinutes, formatRating, totalMinutes } from '#lib/recipe-view.ts';
	import type { DishSummary, MadeDishSummary } from '#lib/server/data/dishes.ts';
	import { foldCase, joinAnd } from '#lib/text.ts';

	let { data } = $props();

	// Import recipes comes here with what it did as navigation state (design 7, Import recipes),
	// and the list says so until the next navigation. Only the app sets that state, so a link
	// can't make the list say something else (MEA-81). A reload doesn't apply it, and it's
	// dropped straight away, so coming back with Back doesn't say it again either.
	let imported = $state<string | null>(null);
	afterNavigate(({ to, shallow }) => {
		// Dropping it is a navigation too.
		if (shallow || !to) return;
		imported = page.state.importSummary ?? null;
		if (imported !== null) void goto(to.url, { state: {}, shallow: true, replace: true });
	});

	// Every tag being filtered by gets a chip, so it can be removed, even when no active recipe
	// has it (it's only on archived ones, or the link is old).
	const chips = $derived([
		...data.tags,
		...data.selectedTags.filter(
			(tag) => !data.tags.some((other) => foldCase(other) === foldCase(tag))
		)
	]);

	function isSelected(tag: string) {
		return data.selectedTags.some((selected) => foldCase(selected) === foldCase(tag));
	}

	/**
	 * This list's address with the given search, tags, archived switch and view, keeping the sort.
	 * Archived recipes are only listed, so their address has no view.
	 */
	function listAddress(search: string, tags: string[], archived: boolean, view = data.view) {
		const params = new URLSearchParams();
		if (search) params.set('q', search);
		for (const tag of tags) params.append('tag', tag);
		if (archived) params.set('archived', '1');
		else if (view === 'grouped') params.set('view', view);
		if (data.sort !== 'name') params.set('sort', data.sort);
		const query = params.toString();
		return query === '' ? '/recipes' : `/recipes?${query}`;
	}

	/**
	 * This list with the tag added to the ones it's filtered by, or removed when it's one of
	 * them, keeping the other tags, the search, the archived switch and the view (section 7,
	 * "Recipes").
	 */
	function toggled(tag: string) {
		const tags = isSelected(tag)
			? data.selectedTags.filter((selected) => foldCase(selected) !== foldCase(tag))
			: [...data.selectedTags, tag];
		return listAddress(data.search, tags, data.archived);
	}

	function details(recipe: DishSummary) {
		const total = totalMinutes(recipe.prepMinutes, recipe.cookMinutes);
		const time = total === null ? '' : formatMinutes(total);
		return [time, recipe.tags.join(', ')].filter((part) => part !== '').join(' · ');
	}

	/** List first, as the default (section 7, "Recipes"). */
	const VIEWS = [
		{ view: 'list', label: 'List' },
		{ view: 'grouped', label: 'Grouped' }
	] as const;

	/**
	 * The Grouped view's groups that have recipes, in order, each recipe with its last date on the
	 * Menu as its card shows it (section 7, "Recipes").
	 */
	const groups = $derived.by(() => {
		if (data.view !== 'grouped') return [];
		const { today } = data;
		const made = (recipe: MadeDishSummary) => ({
			recipe,
			lastMade: formatDateLabel(recipe.lastMade, { today })
		});
		return [
			{ id: 'recent', title: 'Recently made', cards: data.groups.recent.map(made) },
			{
				id: 'long-ago',
				title: "Haven't made in a long time",
				cards: data.groups.longAgo.map(made)
			},
			{
				id: 'never',
				title: 'Never made',
				cards: data.groups.never.map((recipe) => ({ recipe, lastMade: null }))
			}
		].filter((group) => group.cards.length > 0);
	});

	const noMatches = $derived(
		`No ${data.archived ? 'archived ' : ''}recipes` +
			(data.search ? ` matching “${data.search}”` : '') +
			(data.selectedTags.length > 0 ? ` tagged ${joinAnd(data.selectedTags)}` : '') +
			'.'
	);
</script>

<svelte:head>
	<title>Recipes · Meals</title>
</svelte:head>

<div class="title row">
	<h1 class="grow">{data.archived ? 'Archived recipes' : 'Recipes'}</h1>
	<a class="button" href="/recipes/import">Import</a>
	<a class="button primary" href="/recipes/new">New recipe</a>
</div>

{#if imported}<p class="imported" role="status">{imported}</p>{/if}

<form method="GET" class="row search" data-sveltekit-replacestate data-sveltekit-reset="false">
	{#each data.selectedTags as tag (tag)}<input type="hidden" name="tag" value={tag} />{/each}
	{#if data.archived}<input type="hidden" name="archived" value="1" />{/if}
	{#if data.view === 'grouped'}<input type="hidden" name="view" value="grouped" />{/if}
	<SearchBox label="Search recipes" value={data.search} />
	{#if data.view === 'list'}
		<!-- Reorders right away (section 7, "Recipes"). -->
		<label class="visually-hidden" for="sort">Sort</label>
		<select
			class="sort"
			id="sort"
			name="sort"
			value={data.sort}
			onchange={(event) => event.currentTarget.form?.requestSubmit()}
		>
			<option value="name">Name</option>
			<option value="rating">Rating</option>
		</select>
	{:else if data.sort !== 'name'}
		<!-- Grouped has its own order, and keeps the list's for switching back. -->
		<input type="hidden" name="sort" value={data.sort} />
	{/if}
</form>

<!-- Archived recipes are only listed. -->
{#if !data.archived}
	<ul class="views" aria-label="View">
		{#each VIEWS as { view, label } (view)}
			<li>
				<a
					class="button"
					href={listAddress(data.search, data.selectedTags, false, view)}
					aria-current={data.view === view ? 'true' : undefined}>{label}</a
				>
			</li>
		{/each}
	</ul>
{/if}

{#if chips.length > 0}
	<ul class="chips" aria-label="Filter by tag">
		{#each chips as tag (tag)}
			{@const selected = isSelected(tag)}
			<li>
				<a class="chip" href={toggled(tag)} aria-current={selected ? 'true' : undefined}>{tag}</a>
			</li>
		{/each}
	</ul>
{/if}

<p>
	{#if data.archived}
		<a class="link-tap" href={listAddress(data.search, data.selectedTags, false)}>Show active</a>
	{:else}
		<a class="link-tap" href={listAddress(data.search, data.selectedTags, true)}>Show archived</a>
	{/if}
</p>

<!-- A recipe's card, the same in both views. Grouped adds when it was last made. -->
{#snippet card(recipe: DishSummary, lastMade: string | null)}
	{@const info = details(recipe)}
	<a class="recipe" href="/recipes/{recipe.id}">
		{#if recipe.photoKey}
			<img
				class="thumb"
				src="/photos/{recipe.photoKey}-thumb.jpg"
				alt=""
				width="64"
				height="64"
				loading="lazy"
			/>
		{:else}
			<span class="thumb" aria-hidden="true"></span>
		{/if}
		<span class="text">
			<span class="name">{recipe.name}</span>
			{#if info}<span class="muted small">{info}</span>{/if}
			{#if lastMade}<span class="muted small">Last made {lastMade}</span>{/if}
			{#if !recipe.hasRecipe}<span class="badge">No recipe</span>{/if}
		</span>
		{#if recipe.rating || recipe.tried}
			<span class="corner">
				{#if recipe.rating}<span class="rating">{formatRating(recipe.rating)}</span>{/if}
				{#if recipe.tried}<span class="badge tried">Tried</span>{/if}
			</span>
		{/if}
	</a>
{/snippet}

{#if data.view === 'grouped' && groups.length > 0}
	{#each groups as group (group.id)}
		<section class="group" aria-labelledby="group-{group.id}">
			<h2 id="group-{group.id}">{group.title}</h2>
			<ul class="list card recipes">
				{#each group.cards as { recipe, lastMade } (recipe.id)}
					<li>{@render card(recipe, lastMade)}</li>
				{/each}
			</ul>
		</section>
	{/each}
{:else if data.view === 'list' && data.recipes.length > 0}
	<ul class="list card recipes">
		{#each data.recipes as recipe (recipe.id)}
			<li>{@render card(recipe, null)}</li>
		{/each}
	</ul>
{:else if data.search || data.selectedTags.length > 0}
	<p class="muted">{noMatches}</p>
	<a class="link-tap" href={listAddress('', [], data.archived)}>
		{data.archived ? 'Show all archived recipes' : 'Show all recipes'}
	</a>
{:else if data.archived}
	<p class="muted">No archived recipes.</p>
{:else}
	<p class="empty muted">No recipes yet. Tap New recipe to add your first one.</p>
{/if}

<style>
	.title {
		margin-bottom: 0.5rem;
	}

	.title h1 {
		margin: 0;
	}

	.search {
		margin-bottom: 0.75rem;
	}

	.imported {
		font-weight: 700;
		color: var(--received);
	}

	.sort {
		width: auto;
	}

	/* Like a dinner's type buttons, the current view is filled in, not only colored. Each shrinks
	   to fit a narrow phone. */
	.views {
		list-style: none;
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 9rem));
		gap: 0.5rem;
		margin: 0 0 0.75rem;
		padding: 0;
	}

	.views .button {
		width: 100%;
		padding-inline: 0.5rem;
	}

	.views [aria-current='true'] {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}

	/* A list card has no margin of its own, so each group's heading needs room from the card
	   above. */
	.group + .group {
		margin-top: 1.5rem;
	}

	.recipes {
		padding: 0 1rem;
	}

	.recipe {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: var(--tap);
		padding: 0.25rem 0;
		color: inherit;
		text-decoration: none;
	}

	.thumb {
		flex: none;
		width: 64px;
		height: 64px;
		border-radius: 10px;
		object-fit: cover;
		background: var(--surface-sunk);
	}

	.text {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.15rem;
		min-width: 0;
	}

	.name {
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.small {
		font-size: 0.9rem;
		overflow-wrap: anywhere;
	}

	/* The rating in the card's upper right corner, Tried in the bottom right (section 7,
	"Recipes"). */
	.corner {
		flex: none;
		align-self: stretch;
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		margin-left: auto;
		padding: 0.25rem 0;
	}

	.rating {
		font-size: 0.9rem;
		font-weight: 700;
		white-space: nowrap;
	}

	.tried {
		margin-top: auto;
	}

	.empty {
		text-align: center;
		padding: 2rem 0;
	}
</style>
