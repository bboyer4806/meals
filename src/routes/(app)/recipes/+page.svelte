<script lang="ts">
	import { formatMinutes, totalMinutes } from '#lib/recipe-view.ts';
	import { foldCase } from '#lib/text.ts';

	let { data } = $props();

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

	/** This list filtered by another tag, or by none, keeping the search and archived switch. */
	function withTag(tag: string | null) {
		const params = new URLSearchParams();
		if (data.search) params.set('q', data.search);
		if (tag !== null) params.set('tag', tag);
		if (data.archived) params.set('archived', '1');
		const query = params.toString();
		return query === '' ? '/recipes' : `/recipes?${query}`;
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
	<a class="button primary" href="/recipes/new">New recipe</a>
</div>

<form method="GET" class="row search">
	{#if data.tag}<input type="hidden" name="tag" value={data.tag} />{/if}
	{#if data.archived}<input type="hidden" name="archived" value="1" />{/if}
	<label class="visually-hidden" for="q">Search recipes</label>
	<input class="grow" id="q" name="q" type="search" placeholder="Search" value={data.search} />
	<button>Search</button>
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
		<a class="link-tap" href="/recipes">Show active</a>
	{:else}
		<a class="link-tap" href="/recipes?archived=1">Show archived</a>
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
				</a>
			</li>
		{/each}
	</ul>
{:else if data.search || data.tag}
	<p class="muted">{noMatches}</p>
	<a class="link-tap" href={data.archived ? '/recipes?archived=1' : '/recipes'}>
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

	.empty {
		text-align: center;
		padding: 2rem 0;
	}
</style>
