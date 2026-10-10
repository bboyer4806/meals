<script lang="ts">
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';

	let { data, children } = $props();
	let menuOpen = $state(false);

	afterNavigate(() => {
		menuOpen = false;
	});

	// A tab stays current on the pages under it, such as Items under Groceries.
	function current(path: string): 'page' | undefined {
		const { pathname } = page.url;
		return pathname === path || pathname.startsWith(`${path}/`) ? 'page' : undefined;
	}
</script>

<header class="no-print">
	<div class="bar">
		<a class="brand link-tap" href="/groceries">Meals</a>
		<span class="household">{data.householdName}</span>
		<details class="menu" bind:open={menuOpen}>
			<!-- Not "Menu", which is the menu of dinners in the tab bar. -->
			<summary>More</summary>
			<nav aria-label="More">
				<a href="/pantry">Pantry check</a>
				<a href="/groceries/items">Items</a>
				<a href="/groceries/history">History</a>
				<a href="/household">Household</a>
				{#if data.user.isAdmin}
					<a href="/admin">Admin</a>
				{/if}
				<form method="POST" action="/logout">
					<button class="quiet">Sign out</button>
				</form>
			</nav>
		</details>
	</div>
</header>

<main class="page">
	{@render children()}
</main>

<!-- Phone-style tabs at the bottom (design 7). -->
<nav class="tabs no-print" aria-label="Main">
	<a href="/groceries" aria-current={current('/groceries')}>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M7 10a5 5 0 0 1 10 0" />
			<path d="M3 10h18l-2 10H5z" />
			<path d="M9.5 14v3M14.5 14v3" />
		</svg>
		Groceries
	</a>
	<a href="/menu" aria-current={current('/menu')}>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<rect x="3" y="5" width="18" height="16" rx="2" />
			<path d="M3 10h18M8 3v4M16 3v4" />
		</svg>
		Menu
	</a>
	<a href="/recipes" aria-current={current('/recipes')}>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3z" />
			<path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z" />
		</svg>
		Recipes
	</a>
</nav>

<style>
	header {
		position: sticky;
		top: 0;
		z-index: 20;
		background: var(--bg);
		border-bottom: 1px solid var(--border);
		padding-top: env(safe-area-inset-top);
	}

	.bar {
		max-width: 40rem;
		margin: 0 auto;
		padding: 0.25rem 1rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 56px;
	}

	.brand {
		font-family: var(--font-heading);
		font-size: 1.5rem;
		font-weight: 700;
		color: var(--accent);
		text-decoration: none;
	}

	.household {
		flex: 1;
		min-width: 0;
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.menu {
		position: relative;
	}

	summary {
		list-style: none;
		cursor: pointer;
		font-weight: 700;
		min-height: var(--tap);
		display: flex;
		align-items: center;
		padding: 0 0.75rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
	}

	summary::-webkit-details-marker {
		display: none;
	}

	.menu nav {
		position: absolute;
		right: 0;
		top: calc(100% + 6px);
		min-width: 12rem;
		display: flex;
		flex-direction: column;
		padding: 0.5rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: var(--shadow);
	}

	.menu a,
	.menu button {
		display: flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 0.75rem;
		border-radius: 8px;
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
	}

	.menu button {
		width: 100%;
		justify-content: flex-start;
		color: var(--accent);
	}

	.menu a:hover {
		background: var(--surface-sunk);
	}

	main,
	.tabs {
		--tabs-height: 3.5rem;
	}

	/* Room for the tab bar, so it never covers the end of a page. */
	main {
		padding-bottom: calc(var(--tabs-height) + 2rem + env(safe-area-inset-bottom));
	}

	.tabs {
		position: fixed;
		inset: auto 0 0;
		z-index: 20;
		display: flex;
		justify-content: center;
		background: var(--surface);
		border-top: 1px solid var(--border);
		padding-bottom: env(safe-area-inset-bottom);
	}

	.tabs a {
		flex: 1;
		max-width: 10rem;
		min-height: var(--tabs-height);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.125rem;
		color: var(--muted);
		font-size: 0.85rem;
		font-weight: 700;
		text-decoration: none;
	}

	/* Color plus a bar along the top, so the current tab doesn't rely on color alone. */
	.tabs a[aria-current='page'] {
		color: var(--accent);
		box-shadow: inset 0 3px 0 var(--accent);
	}

	.tabs svg {
		width: 24px;
		height: 24px;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	@media print {
		main {
			padding: 0;
		}
	}
</style>
