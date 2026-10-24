<script lang="ts">
	import { afterNavigate, goto } from '$app/navigation';
	import SearchBox from '#lib/components/SearchBox.svelte';
	import { formatMinutes, formatRating, totalMinutes } from '#lib/recipe-view.ts';
	import { foldCase, joinAnd } from '#lib/text.ts';

	let { data } = $props();

	// Import recipes comes here with what it did in the address (design 7, Import recipes), and
	// the list says so until the next navigation. The address drops it straight away, so a
	// reload, or coming back with Back, doesn't say it again.
	let imported = $state<string | null>(null);
	afterNavigate(({ to, shallow }) => {
		// Dropping it from the address is a navigation too.
		if (shallow || !to) return;
		imported = importMessage(to.url.searchParams);
		if (imported === null) return;
		const address = new URL(to.url);
		for (const name of ['imported', 'replaced', 'skipped', 'ignored']) {
			address.searchParams.delete(name);
		}
		void goto(address, { shallow: true, replace: true });
	});

	/** "Imported 9 recipes, replaced 2 and skipped 3. Ignored columns: Step and Rating." */
	function importMessage(params: URLSearchParams): string | null {
		const count = params.get('imported');
		if (count === null) return null;
		const replaced = Number(params.get('replaced'));
		const skipped = Number(params.get('skipped'));
		const ignored = params.getAll('ignored');
		const parts = [
			`Imported ${count} ${count === '1' ? 'recipe' : 'recipes'}`,
			...(replaced > 0 ? [`replaced ${replaced}`] : []),
			...(skipped > 0 ? [`skipped ${skipped}`] : [])
		];
		let message = `${joinAnd(parts)}.`;
		if (ignored.length > 0) {
			message += ` Ignored ${ignored.length === 1 ? 'column' : 'columns'}: ${joinAnd(ignored)}.`;
		}
		return message;
	}

	type Recipe = (typeof data.recipes)[number];

	// The tag being filtered by always gets a chip, so it can be cleared, even when no active
	// recipe has it (it's only on archived ones, or the link is old).
	const chips = $derived.by(() => {
		const tag = data.tag;
		if (tag === null || data.tags.some((other) => foldCase(other) === foldCase(tag))) {
			return data.tags;
		}
		return [...data.tags, tag];
	});

	function isCurrent(tag: string) {
		return data.tag !== null && foldCase(tag) === foldCase(data.tag);
	}

	/** This list's address with the given search, tag and archived switch, keeping the sort. */
	function listAddress(search: string, tag: string | null, archived: boolean) {
		const params = new URLSearchParams();
		if (search) params.set('q', search);
		if (tag !== null) params.set('tag', tag);
		if (archived) params.set('archived', '1');
		if (data.sort !== 'name') params.set('sort', data.sort);
		const query = params.toString();
		return query === '' ? '/recipes' : `/recipes?${query}`;
	}

	/** This list filtered by another tag, or by none, keeping the search and archived switch. */
	function withTag(tag: string | null) {
		return listAddress(data.search, tag, data.archived);
	}

	function details(recipe: Recipe) {
		const total = totalMinutes(recipe.prepMinutes, recipe.cookMinutes);
		const time = total === null ? '' : formatMinutes(total);
		return [time, recipe.tags.join(', ')].filter((part) => part !== '').join(' · ');
	}

	const noMatches = $derived(
		`No ${data.archived ? 'archived ' : ''}recipes` +
			(data.search ? ` matching “${data.search}”` : '') +
			(data.tag ? ` tagged ${data.tag}` : '') +
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
	{#if data.tag}<input type="hidden" name="tag" value={data.tag} />{/if}
	{#if data.archived}<input type="hidden" name="archived" value="1" />{/if}
	<SearchBox label="Search recipes" value={data.search} />
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
</form>

{#if chips.length > 0}
	<ul class="chips" aria-label="Filter by tag">
		{#each chips as tag (tag)}
			{@const current = isCurrent(tag)}
			<li>
				<a
					class="chip"
					href={withTag(current ? null : tag)}
					aria-current={current ? 'true' : undefined}>{tag}</a
				>
			</li>
		{/each}
	</ul>
{/if}

<p>
	{#if data.archived}
		<a class="link-tap" href={listAddress(data.search, data.tag, false)}>Show active</a>
	{:else}
		<a class="link-tap" href={listAddress(data.search, data.tag, true)}>Show archived</a>
	{/if}
</p>

{#if data.recipes.length > 0}
	<ul class="list card recipes">
		{#each data.recipes as recipe (recipe.id)}
			{@const info = details(recipe)}
			<li>
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
						{#if !recipe.hasRecipe}<span class="badge">No recipe</span>{/if}
					</span>
					{#if recipe.rating || recipe.tried}
						<span class="corner">
							{#if recipe.rating}<span class="rating">{formatRating(recipe.rating)}</span>{/if}
							{#if recipe.tried}<span class="badge tried">Tried</span>{/if}
						</span>
					{/if}
				</a>
			</li>
		{/each}
	</ul>
{:else if data.search || data.tag}
	<p class="muted">{noMatches}</p>
	<a class="link-tap" href={listAddress('', null, data.archived)}>
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
