<script lang="ts">
	import { afterNavigate } from '$app/navigation';

	let { data, children } = $props();
	let menuOpen = $state(false);

	afterNavigate(() => {
		menuOpen = false;
	});
</script>

<header>
	<div class="bar">
		<a class="brand" href="/groceries">Meals</a>
		<span class="household">{data.householdName}</span>
		<details class="menu" bind:open={menuOpen}>
			<summary>Menu</summary>
			<nav aria-label="Main">
				<a href="/groceries">Groceries</a>
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

	nav {
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

	nav a,
	nav button {
		display: flex;
		align-items: center;
		min-height: var(--tap);
		padding: 0 0.75rem;
		border-radius: 8px;
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
	}

	nav button {
		width: 100%;
		justify-content: flex-start;
		color: var(--accent);
	}

	nav a:hover {
		background: var(--surface-sunk);
	}
</style>
